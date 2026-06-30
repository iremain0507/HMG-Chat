# 03 · Architecture — 시스템 아키텍처 (HLD)

## 한 그림 요약

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                            │
│  apps/web (Next.js 15)  ─  React Context  ─  Tailwind v4             │
└────────────────────────────┬─────────────────────────────────────────┘
                             │ HTTPS (HttpOnly cookie + JWT)
                             │ SSE for streaming
┌────────────────────────────▼─────────────────────────────────────────┐
│                          ALB  ({{ORG_NAME}} ELB)                           │
└──────────┬──────────────────────────┬──────────────────────────┬─────┘
           │                          │                          │
   ┌───────▼────────┐         ┌───────▼────────┐         ┌───────▼─────┐
   │  apps/server   │         │ converter-     │         │ sandbox-    │
   │  (Hono, Fargate)│        │ worker (Far-   │         │ worker      │
   │                │         │ gate)          │         │ (E2B proxy) │
   │ - routes/      │         │ LibreOffice    │         │             │
   │ - orchestrator │         │ PPTX→PDF       │         │ Cloud Map   │
   │ - tools/       │         └───────┬────────┘         └─────────────┘
   │ - mcp/         │                 │                         │
   │ - knowledge/   │                 │                         │
   │ - db/          │                 │                         │
   └───┬────┬───┬───┘                 │                         │
       │    │   │                     │                         │
       │    │   └────────────────S3 bucket────────────────────  │
       │    │                          (uploads, artifacts)     │
       │    │                                                   │
       │    └────────────── Redis (ElastiCache) ────────────────┘
       │                    (session locks, HITL queue, cache)
       │
   ┌───▼─────────────────────────────────────────┐
   │ PostgreSQL 16 + pgvector (RDS)              │
   │ - organizations / users / sessions / ...    │
   │ - document_chunks (vector + bm25)           │
   │ - user_memories / artifacts / mcp_servers   │
   └─────────────────────────────────────────────┘

External:
  - Anthropic Claude API (primary LLM)
  - OpenAI / Gemini (fallback)
  - Voyage AI (embeddings)
  - Tavily (web search)
  - E2B (sandbox runtime)
```

## 레이어드 아키텍처

### Layer 1 — Edge & Auth
- ALB + WAF (사내 보안 정책)
- Auth middleware: JWT (HttpOnly cookie or Bearer)
- Rate limit middleware (per-user, per-endpoint)
- CSP/CORS headers

### Layer 2 — Application (`apps/server`)
**Hono framework**. 모듈 경계:

```
src/
├── app.ts                 # 라우트 등록, 미들웨어 체이닝
├── index.ts               # 서버 부트스트랩
├── middleware/            # auth, jwt, rls-context, rate-limit, csp, ...
├── routes/                # HTTP endpoints (한 도메인당 1 파일)
│   ├── auth.ts
│   ├── sessions.ts
│   ├── messages.ts        # 메시지 수신 + job enqueue
│   ├── projects.ts
│   ├── artifacts.ts
│   ├── artifact-shares.ts
│   ├── skills.ts
│   ├── uploads.ts
│   ├── memories.ts
│   ├── notifications.ts   # SSE
│   ├── mcp-servers.ts
│   ├── config.ts
│   ├── usage.ts / quota.ts
│   ├── admin/             # ops 대시보드 routes
│   └── public-share.ts    # 인증 없는 공유 페이지
├── orchestrator/          # 메시지 처리 비즈니스 로직
│   ├── orchestrator.ts    # main loop
│   ├── prompt-builder.ts  # 4계층 권한 (Sys/Proj/User/Tool)
│   ├── memory-extractor.ts
│   ├── memory-retriever.ts
│   ├── context-compactor.ts
│   ├── title-generator.ts
│   ├── query-rewriter.ts
│   └── citation-helper.ts
├── tools/                 # 도구 시스템
│   ├── tool-router.ts
│   ├── policy-engine.ts   # 도구 허용/HITL/거부
│   ├── hitl-manager.ts
│   ├── choice-manager.ts
│   ├── handlers/          # 빌트인 도구 (bash, file, web 등)
│   └── sandbox/
│       └── transport.ts   # interface — E2B/Mock 구현 분리
├── knowledge/             # RAG pipeline
│   ├── parser-pipeline.ts
│   ├── pdf-parser.ts
│   ├── pptx-parser.ts
│   ├── docx-parser.ts
│   ├── xlsx-parser.ts
│   ├── chunker.ts
│   ├── embedding-provider.ts (Voyage)
│   └── search-service.ts  # hybrid (vector + bm25 + RRF)
├── mcp/
│   ├── mcp-bridge.ts
│   ├── mcp-client-pool.ts
│   └── url-validator.ts   # SSRF 보호
├── db/
│   ├── schema.ts          # Drizzle ORM
│   ├── migrations/
│   ├── data-access.ts     # interface
│   ├── drizzle-data-access.ts  # production impl
│   └── *-service.ts       # 도메인별 서비스
└── lib/                   # 공유 유틸 (logger, rate-limiter, ...)
```

### Layer 3 — Data
- **PostgreSQL 16 + pgvector** (RDS) — 모든 정형 데이터 + 벡터
- **Redis 7** (ElastiCache) — session locks, HITL queue, rate limit counters, cache
- **S3** — 사용자 업로드 + 생성 artifact (큰 파일은 presigned URL 다운로드)

### Layer 4 — Worker Services
- **converter-worker** (Fargate) — LibreOffice 기반 PPTX/DOCX → PDF (server 와 분리, [L17](01-LESSONS-LEARNED.md#l17))
- **sandbox-worker** (옵션) — E2B 호출의 retry/circuit-breaker (Cloud Map service discovery)

### Layer 5 — External
- LLM: Anthropic (primary), OpenAI / Gemini (fallback)
- Tavily, Voyage AI
- E2B (sandbox runtime)
- 사내 MCP 서버들

## 핵심 데이터 흐름

### Flow A — 메시지 처리 (사용자 입력 → 응답)

```
1. POST /api/v1/sessions/:id/messages
   ↓ (auth, rate-limit, rls)
2. routes/messages.ts: validate + enqueue job
   ↓
3. message-job-executor.ts: lock session (Redis)
   ↓
4. orchestrator.ts: 
   - prompt-builder 호출 (4계층 prompt 조합)
   - memory-retriever 로 user_memories pin
   - context-compactor 로 긴 history 압축
   - LLM 호출 (streaming) with abort signal
   ↓
5. tool-router: 도구 호출 분기
   ├─ bash / file → sandbox-transport (E2B)
   ├─ knowledge_search → search-service (pgvector + bm25)
   ├─ web_search → Tavily
   ├─ skill 활성화 → SKILL.md → prompt 추가
   ├─ MCP 도구 → mcp-bridge
   └─ HITL/Choice → 사용자 응답 대기 (Redis queue)
   ↓
6. SSE stream → client (chunk by chunk)
   ↓
7. 메시지 종료: 
   - memory-extractor 가 백그라운드로 user_memories 추출
   - usage-logger 기록
   - artifact 가 생성됐다면 artifacts 테이블 + S3 저장
```

### Flow B — 지식 문서 파싱 + 인덱싱

```
1. POST /api/v1/projects/:id/documents (multipart)
   ↓ S3 업로드, project_documents.status=pending
2. parser-pipeline 호출 (별도 worker 또는 inline)
   ├─ PDF: pdf-parser (v1.0 default: Gemini VLM. Docling 은 v1.1 옵션)
   ├─ PPTX: pptx-parser (python-pptx)
   ├─ DOCX: docx-parser (python-docx)
   └─ XLSX: xlsx-parser (openpyxl AST)
   → markdown
3. chunker: 청크 분할 (오버랩 200토큰)
4. embedding-provider: Voyage AI 임베딩
5. document_chunks 에 insert (content + embedding + bm25_tsvector)
6. project_documents.status=indexed
```

### Flow C — Artifact 공유 링크

```
1. POST /api/v1/artifacts/:id/share
   ↓ artifact_shares insert (token=UUID v4 122-bit, expires_at=NOW+30d)
2. 응답: { url: "/share/<token>" }
3. 익명 사용자가 GET /api/v1/share/<token>
   ↓ authMiddleware 전에 mount (인증 우회)
   ↓ artifact_shares + artifacts join, expires check
4. inline content 응답 (CSP 우회용 — ADR-22)
5. 발급자가 DELETE → token revoke → 410 Gone
```

## 경계 인터페이스 (팀간 동기화 포인트)

도메인 팀들이 독립적으로 일하기 위한 **`packages/interfaces`** 의 명시 contract (12개 — 8개 핵심 + HitlBridge/BudgetClaim/Logger/EmailSender 보조, [14-INTERFACES.md](14-INTERFACES.md) 단일 출처):

| # | Interface | 역할 |
|---|---|---|
| 1 | `AgentTool` | 도구 일반 인터페이스 — orchestrator ↔ handlers/MCP/Skill 동일 호출 |
| 2 | `SandboxTransport` | sandbox 추상화 — E2B/Mock |
| 3 | `DataAccess` | DB 추상화 — production/InMemory |
| 4 | `ArtifactStore` | artifact 저장소 — DB(BYTEA)/S3 |
| 5 | `EmbeddingProvider` | 임베딩 — Voyage/Mock |
| 6 | `LLMProvider` | LLM — Anthropic/OpenAI/Gemini 어댑터 |
| 7 | `SkillRegistry` | 스킬 발견 + SKILL.md 로딩 |
| 8 | `McpClientPool` | MCP 도구 발견 + 호출 |
| 9 | `HitlBridge` | (보조) ToolContext.hitl — HITL 대기 |
| 10 | `BudgetClaim` | (보조) ToolContext.budget — quota 차감 |
| 11 | `Logger` | (보조) ToolContext.logger — 구조화 로그 |
| 12 | `EmailSender` | (보조) magic-link / signup / share 이메일 발송 (auth 흐름 의존, Phase 1+ 부터 필수) |

각 인터페이스는 `packages/interfaces/src/<name>.ts` 에 위치 — [05-REPO-STRUCTURE.md § packages/interfaces](05-REPO-STRUCTURE.md) 의 파일 list 와 일치.

## 비기능 아키텍처

### 가용성
- ALB + 2개 가용영역 (multi-AZ)
- RDS Multi-AZ (자동 failover 60s)
- Redis cluster mode (옵션)
- Stateless server: ECS auto-scaling (CPU 70% → scale out)

### 확장성
- Sandbox: warm pool (워밍 컨테이너 N개 사전 할당, idle 15min)
- Knowledge indexing: 별도 worker (queue 기반)
- LLM 호출: 비동기 job + SSE streaming

### 보안
- **인증**: HttpOnly cookie + JWT (15분 access + refresh)
- **권한**: 4계층 prompt + RLS (row-level security) + tool policy
- **격리**: Sandbox 는 외부 E2B (서버 host 와 무관)
- **MCP SSRF**: RFC-1918 차단 + VPC CIDR 화이트리스트
- **Secrets**: AWS Secrets Manager + IAM role

### 관측
- 구조화 로그 (Pino + JSON)
- 메트릭: CloudWatch metrics + custom (도구 호출 / 카테고리 별)
- Trace: OpenTelemetry → AWS X-Ray (옵션)
- Alarm: SNS → Slack

자세한 부분은 [11-DEPLOYMENT.md](11-DEPLOYMENT.md), [12-OPS-SECURITY.md](12-OPS-SECURITY.md) 참조.

## 인터페이스 & 권한

> **상세 인터페이스 시그니처**: [14-INTERFACES.md](14-INTERFACES.md) 참조 (12개 인터페이스의 TypeScript 본문 + Anthropic SSE → ChatEvent 매핑 + Skill 활성화 알고리즘 등).

> **권한 4계층 충돌 매트릭스**: [14-INTERFACES.md § 권한 4계층](14-INTERFACES.md#권한-4계층-permission-tier--충돌-해결-매트릭스-단일-출처) — `System > Project > User > Tool` (단일 출처).

## Citation Pipeline (6단계, I5 보완)

`apps/server/src/orchestrator/citation-helper.ts`:

```ts
// 단계 1: LLM 응답에서 [1], [2] 같은 inline reference 추출 + 정규화
function extractInlineRefs(text: string): { text: string; refs: number[] };

// 단계 2: 청구된 ref 번호와 tool_result 의 source 매칭
function matchRefsToSources(refs: number[], toolResults: ToolResult[]): RefSourceMap;

// 단계 3: 매칭 안 된 ref (LLM 환각) 검출 + 제거
function stripLlmReferences(text: string, validRefs: Set<number>): string;

// 단계 4: 사용된 source 만 Reference 섹션에 채택 (불필요한 출처 제거)
function selectUsedSources(refMap: RefSourceMap): Source[];

// 단계 5: Reference 섹션 markdown 생성
function generateReferences(sources: Source[]): string;
// 출력 예: "## Reference\n[1] 문서 제목 (페이지 3) — s3://bucket/doc.pdf#page=3"

// 단계 6: inline + 하단 섹션 결합
function attachCitations(answer: string, refsBlock: string): string;
```

**스트리밍 vs 후처리 정책 (단일 출처)**: citation 의 inline `[N]` 마커는 LLM 응답에 자연스럽게 포함되어 **stream 중에 그대로 client 로 전달** (text_delta event). server 가 stream 후 `citation` SSE event 로 reference snippet 발행 ([16 § /messages SSE](16-API-CONTRACT.md)). 단계 1~6 은 stream 종료 직후 server side 에서 실행해 **DB 에 저장되는 message 의 final form** 만 정제 (LLM 환각 ref 제거 + Reference 섹션 추가). UI 는 stream 중 raw `[N]` 표시 + stream 종료 후 final form 으로 갱신 (`event: message_replace` — 향후 추가 시).

## ADR 인덱스 (이 문서가 의존하는 결정들)

| ADR | 결정 |
|---|---|
| ADR-001 | LLM: Anthropic Claude primary, OpenAI/Gemini fallback |
| ADR-002 | Sandbox: E2B-only (Docker socket 옵션 없음, L11) |
| ADR-003 | DB: PostgreSQL 16 + pgvector (단일 DB), Drizzle ORM |
| ADR-004 | Cache/Lock: Redis (ElastiCache) |
| ADR-005 | Frontend: Next.js 15 App Router, React Context (Redux 없음) |
| ADR-006 | Backend framework: Hono |
| ADR-007 | Monorepo: pnpm + Turbo, single-version policy (L04) |
| ADR-008 | 권한 모델: 4계층 (System/Project/User/Tool, L05) |
| ADR-009 | 마이그레이션 정책: nullable-first (L03) |
| ADR-010 | 로깅: 구조화 + category/level (L07) |
| ADR-011 | 무거운 의존성: converter worker 분리 (L17) |
| ADR-012 | CI/CD: 3-tier 자동화 (L13) |
| ADR-013 | 인증: HttpOnly cookie + 15분 JWT + refresh |
| ADR-014 | Multi-tenancy: org → org_unit → project → session 4단계 |
| ADR-015 | SSE 가 primary streaming, polling 은 fallback |
| ADR-016 | Identity 격자 강제 (L08) |
| ADR-017 | MR description = ADR (L15, L18) |
| ADR-018 | Skill 시스템: SKILL.md frontmatter, semver (L09) |
| ADR-019 | MCP 통합: org/project/user 3-scope (L16) |
| ADR-020 | Abort signal 의무 (L06) |
| ADR-021 | Artifact share link: token + expires_at, view_count, revoke |
| ADR-022 | Share endpoint inline content (S3 redirect 대신 stream relay — CSP 우회 차단) |

각 ADR 의 카드는 [docs/decisions/](../docs/decisions/) (실 빌드 시 생성). 신규 ADR 은 다음 번호부터 (ADR-023~) 부여.

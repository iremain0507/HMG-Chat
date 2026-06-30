# 08 · Sprint Plan — Phase 0 ~ 9 개발 계획

> 10개 phase 로 분할 (Phase 0 셋업 + 9개 기능 phase). 각 phase 는 1~2주 길이, 6 팀 병렬 진행. 모든 머지는 TDD + CI 게이트 통과 의무.

## 전체 마스터 일정

```
Week:        1  2  3  4  5  6  7  8  9  10 11 12
Phase 0:     ██                                          셋업
Phase 1:        ██                                       Identity & Auth
Phase 2:           ██                                    Session & Message Flow
Phase 3:              ██                                 Projects & Members
Phase 4:                 ██                              Knowledge & RAG
Phase 5:                    ██                           Artifacts
Phase 6:                       ██                        Share & Public
Phase 7:                          ██                     Memory System
Phase 8:                             ██                  Skills & MCP
Phase 9:                                ██  ██  ██       Quota/Ops/Polish/Release
                                                          v1.0 GA → Week 12
```

각 칸 = 1주. 굵게 표시된 phase 가 그 주의 critical path.

## Phase 0 · Week 1 — 셋업 (Setup & Foundations)

**목표**: 모든 팀이 첫 PR 을 만들 수 있는 기반 완성.

### T1 Platform
- AWS 환경 (dev/staging/prod) 셋업 — VPC, RDS, Redis, ECR, ECS cluster
- `.gitlab-ci.yml` 3-tier pipeline 첫 버전 (build / test / lint)
- `.husky/{pre-commit, commit-msg, pre-push}`
- `scripts/{setup-git, tunnel}.sh`
- `infra/aws/setup-infra.sh`

### T2~T6 모두 (Phase 0 에서는 자기 도메인 디렉토리만)
- 각자 자기 도메인 디렉토리 (`apps/server/src/{orchestrator,knowledge,routes,tools}/*` 등) 의 hello-world 수준 진입점 + 첫 vitest 1건 (RED → GREEN)
- ⚠️ `packages/shared` / `packages/interfaces` 본문 작성 **금지** — Phase 0 는 빈 barrel (`export {}`) 만 ([05-REPO-STRUCTURE § 부록 C](05-REPO-STRUCTURE.md)). 12 contract + index.ts/types.ts/errors.ts (총 15 파일) + Zod schema 는 **Phase 0.5 의 Contract Bootstrap PR 단일 owner (integration RC)** 가 작성. T2~T6 는 Phase 1 부터 contract import.

### 산출물 / Gate
- [ ] `pnpm install && pnpm test && pnpm lint && pnpm typecheck` 통과
- [ ] CI 가 PR / main / release pipeline 분기
- [ ] 새 개발자가 README 보고 30분 안에 `pnpm dev` 실행 가능

---

## Phase 0.5 · Week 1 끝 — Contract Bootstrap PR (병렬 분기 직전)

**목표**: T2~T6 가 worktree 분기 전에 shared contract 를 integration owner 가 단일 PR 로 머지.

**산출물 (단일 PR)**: [07-AGENT-TEAMS § Phase 0.5](07-AGENT-TEAMS.md) + [build_prompt § Phase 0.5](build_prompt.md) 단일 출처. 12 interface 파일, Zod shared types, openapi stub, api-client, error registry, envelope middleware, CODEOWNERS, ChatEvent / storageKind freeze.

**acceptance**: `pnpm install/typecheck/lint` + `openapi:generate` + `api-types:generate` + `lint-plan.sh` 모두 0 exit.

**owner**: integration owner (RC). 본 PR 머지 후에야 T2~T6 분기.

---

## Phase 1 · Week 2 — Identity & Auth

**목표**: 사용자 가입/로그인/세션, RLS context.

### 구체 작업
- **DB 마이그레이션 (이 phase 에서 생성·커밋 — 적용 순서는 번호 순)**:
  - `0001_identity.sql` — organizations / org_units / users / user_org_units (RLS 임베디드)
  - `0012_password_or_magic.sql` — users.password_hash + magic_link_tokens (auth 흐름 의존)
  - `0013_refresh_token_families.sql` — JWT refresh rotation family (도난 감지)

> **마이그레이션 번호 = 적용 순서** (drizzle-kit 이 enforce). 본 phase 는 `0001 → 0012 → 0013` 3개를 생성·커밋. 0002~0011 은 Phase 2~9 가 추후 추가하면 그 시점부터 매 migrate 호출에서 `0002 → 0003 → ... → 0011` 순서로 자동 적용. **번호 비연속 OK** — drizzle journal 이 적용된 entry 만 기록. **fresh DB = incremental DB** 가 결정적으로 같은 schema 갖도록 보장 ([06-DATA-MODEL § 마이그레이션 표](06-DATA-MODEL.md)).

> **Phase 별 마이그레이션 적용 정책 (drizzle-kit 운용 — 의도된 설계, 매 라운드 LLM 검토에서 반복 질문되는 부분)**:
>
> 흔한 오해: "번호 비연속 (0001 → 0012 → 0013, 나중 0002) 은 fresh DB 와 incremental DB 가 다른 schema 를 만들 위험 — 재번호화 필요" — **이는 잘못된 우려**. 아래 4 가지 사실로 안전 보장됨:
>
> 1. **drizzle-kit 의 단조 적용**: `drizzle-kit migrate` 는 항상 `0001 → 0002 → ... → 0016` 번호 순으로만 적용. **Phase 가 어느 번호를 언제 만들었는가는 무관**. fresh DB 든 incremental DB 든 동일 순서로 적용 — 결정적.
> 2. **journal 이 단일 source of truth**: `drizzle/meta/_journal.json` 이 적용된 번호만 기록. Phase 1 끝 시점에 `[0001, 0012, 0013]` 적용됨. Phase 2 가 0002 를 추가하면 다음 migrate 호출에서 0002 가 미적용 상태 → drizzle-kit 이 자동 실행 → journal append.
> 3. **번호 = 의존 순서**: 우리는 마이그레이션 번호를 "Phase 에 도입 시점" 이 아니라 "실 의존 순서" 로 매김. 0001 (identity) → 0002 (sessions) → ... → 0016 (indexes). 비연속 (0001 → 0012) 은 "auth 흐름이 sessions 보다 먼저 필요한 Phase 1 의 산출물" 이라 의도된 선택.
> 4. **forward reference 안전망**: 0001 의 `user_role_in_project()` 처럼 후속 마이그레이션의 테이블을 참조하는 함수는 `LANGUAGE plpgsql + EXECUTE + EXCEPTION WHEN undefined_table` 패턴으로 0001 시점에는 NULL 반환, 0004 적용 후 실 동작.
>
> **반증 경로**: "이 정책이 실패하는 시나리오를 보여달라" — CI 의 `migration-dry-run` job ([15-CI § migration-dry-run](15-CI-PIPELINE.md)) 이 빈 DB → 모든 번호 순차 적용 → 두 번째 재실행 idempotency 까지 매 머지 검증. 본 정책이 깨지면 본 job 이 fail.
>
> **세부 정책 (요약)**:
> - 마이그레이션 번호 = 적용 순서 (drizzle journal 강제). Phase 와 무관.
> - 번호 비연속 OK. 후속 Phase 가 같은 journal 에 append.
> - fresh DB = incremental DB 결정적으로 같음 (위 4 가지 사실 + migration-dry-run CI).
> - 0015 (project_documents RLS refine) 는 0005 가 임베디드된 동일 정책 위에 idempotent guard (`to_regclass IF NULL THEN RETURN`) 로 작동.
> - Phase 마다 빈 DB 에서 `pnpm db:migrate && pnpm db:seed` 가 0 exit 통과 의무.
- 인증 흐름: magic link or password (사내 SSO 는 v1.1)
- JWT 발급/검증 (HttpOnly cookie + refresh family rotation)
- middleware/{auth, jwt, rls-context}
- `/api/v1/auth/{signup, login, magic-link, magic-link/verify, logout, me, refresh}` ([16 § 1 단일 출처](16-API-CONTRACT.md))
- web/(auth)/login, signup pages (verify page 없음 — 16 § GET /auth/magic-link/verify 가 server 302 단일 흐름)
- EmailSender (`EMAIL_SENDER_KIND=console` 로 dev 시작 가능, [16 § EmailSender 단일 출처](16-API-CONTRACT.md))

### TDD 우선 작성 테스트
- `auth-service.test.ts` — 이메일 도메인 검증 (`*@{{ORG_DOMAIN}}`)
- `jwt.test.ts` — 토큰 발급/검증/만료
- `rls.test.ts` — 다른 org 사용자 데이터 접근 불가
- `routes/auth.test.ts` — login flow integration

### Gate
- 한 org 의 사용자가 다른 org 데이터를 query 할 수 없음 (RLS 통합 테스트)
- 도메인 외 (`gmail.com`) 가입 시도 → 403

---

## Phase 2 · Week 3 — Session & Message Flow (Minimal)

**목표**: 세션 생성/메시지 송수신 (도구 호출 없이, 단순 LLM 응답만).

### 구체 작업
- 마이그레이션 0002: sessions + messages
- 마이그레이션 0003: sessions_active_runs
- routes/{sessions, messages}.ts
- orchestrator/orchestrator.ts skeleton
- orchestrator/prompt-builder.ts (4계층 권한 enum, L05)
- LLMProvider interface + Anthropic impl
- SSE streaming
- `apps/web/src/hooks/useSessionStream.ts`
- abort flow (L06) — 첫 구현, 모든 LLM 호출에 signal 의무

### TDD 테스트
- `orchestrator.test.ts` — 메시지 → LLM → SSE 흐름
- `prompt-builder.test.ts` — 4계층 prompt 의 우선순위 (`System > Project > User > Tool` — [14-INTERFACES.md § 권한 4계층](14-INTERFACES.md) 단일 출처). 사용자 메모리는 "강한 User" 마크업으로 prompt 안에서 System 다음 등급 명시.
- `abort.test.ts` — abort signal 전파 시 LLM 호출 cancel

### Gate
- 사용자가 채팅에 메시지 보내면 SSE 로 응답 받음
- Stop 클릭 시 서버 잡 즉시 중단 + active_runs.status=cancelled

---

## Phase 3 · Week 4 — Projects & Members

**목표**: 프로젝트 + 멤버 + visibility (private/team/org).

### 구체 작업
- **DB 마이그레이션**:
  - `0004_projects_members.sql` — projects + project_members + sessions.project_id FK
  - `0015_project_team_scope_rls.sql` — projects.org_unit_id + RLS read/write 4-policy 분리 (API 의 visibility=team 지원에 필수)
- routes/projects.ts (CRUD + 멤버 관리, `orgUnitId` 필드 포함)
- web/projects/[projectId] page
- project context → session.project_id 연동
- 권한 검사 (owner/editor/viewer × visibility)

### TDD 테스트
- `project-service.test.ts` — 권한 매트릭스 (viewer가 settings 변경 불가 등)
- `routes/projects.test.ts` — visibility 별 list 결과

### Gate
- 다른 org 의 private 프로젝트 조회 시도 → 404 (existence leak 방지)

---

## Phase 4 · Week 5 — Knowledge & RAG

**목표**: 문서 업로드 → 파싱 → 청크 → 임베딩 → 검색 → citation.

### 구체 작업
- 마이그레이션 0005: project_documents + document_chunks
- 마이그레이션 0014: uploads (세션 첨부 — `routes/uploads.ts` 가 의존)
- knowledge/{parser-pipeline, pdf-parser, pptx-parser, docx-parser, xlsx-parser, chunker, embedding-provider, search-service}
- routes/uploads.ts + S3 upload
- knowledge_search 도구 + citation-helper
- 인덱싱 worker (옵션 또는 inline)
- 비용 측정 (Voyage API 호출 수, embedding cost)
- web/projects/[id] 의 document 업로드 UI

### TDD 테스트
- `parser-pipeline.test.ts` — 4 포맷 모두 markdown 변환
- `chunker.test.ts` — 오버랩 + 토큰 카운트
- `search-service.test.ts` — hybrid score 조합 (vector + bm25 + RRF)
- `citation-helper.test.ts` — `[1]`, `[2]` 번호 매칭

### Gate
- 30 페이지 PDF 가 < 60초 안에 indexing 완료
- knowledge_search 결과에 citation 100% 매칭
- 검색 query 가 모르는 도메인이면 빈 결과 + "관련 문서 없음" 응답

### ⚠️ 경고 (L02)
이 phase 는 원본에서 가장 시행착오가 많았음 (3 MR 폐기). Spike 단계로 시작:
- `spike/rag-architecture` 브랜치에서 3일 prototype
- 결과를 `docs/spikes/2026-XX-rag-architecture.md` 에 정리
- 그 후에 production MR 들 시작

---

## Phase 5 · Week 6 — Artifacts

**목표**: 모델이 생성한 파일 (PPTX/PDF/Markdown/HTML) artifact 로 저장 + 렌더링.

### 구체 작업
- 마이그레이션 0006: artifacts + artifact_revisions
- 마이그레이션 0007: artifact_shares (Phase 6 에서 활성화)
- routes/artifacts.ts
- ArtifactStore interface + Drizzle/S3 impl 분리
- converter-worker (Python) skeleton — PPTX → PDF (LibreOffice)
- web/components/artifacts/{PdfRenderer, PptxRenderer, ArtifactPanel}
- bash 도구가 sandbox 안에서 PPTX 생성 → 자동으로 artifact 등록

### TDD 테스트
- `artifact-service.test.ts` — db/s3 라우팅 (size threshold)
- `converter-worker` 단위 테스트 (mock LibreOffice)
- `ArtifactPanel.test.tsx` — preview 렌더

### Gate
- 10MB PPTX artifact 가 web preview 에서 5초 이내 표시
- artifact 다운로드 URL 이 S3 presigned (사용자 token 만료 시 차단)

---

## Phase 6 · Week 7 — Share & Public

**목표**: artifact 공유 링크 (30일 만료, 익명 접근, CSP 우회).

### 구체 작업
- routes/artifact-shares.ts + routes/public-share.ts (인증 전 mount)
- web/share/[token] page
- expires/revoke flow
- inline content 응답 (S3 직접 보내는 대신 stream relay, ADR-22)
- view_count 추적

### TDD 테스트
- `artifact-share-service.test.ts` — 토큰 발급/만료/revoke
- `routes/public-share.test.ts` — 인증 없이 접근 + expired → 410
- `share.security.test.ts` — token guessing attack (122-bit 안전)

### Gate
- 만료된 토큰 접근 → 410 Gone
- revoke 후 즉시 차단

### ⚠️ 경고 (L03)
이 phase 는 마이그레이션 변경 (artifacts.session_id NOT NULL → nullable) 이 필요. 처음부터 nullable 설계 → 마이그레이션 0006 에서 이미 nullable. typecheck 가 같은 PR 안에서 통과.

---

## Phase 7 · Week 8 — Memory System

**목표**: 사용자 메모리 자동 추출 + 시스템 prompt 주입 (영구 지시사항 등급).

### 구체 작업
- 마이그레이션 0008: user_memories + memory_extraction_locks
- orchestrator/{memory-extractor, memory-retriever}
- routes/memories.ts (CRUD + pin)
- web/settings/memories UI (4 카테고리 별 관리)
- prompt-builder 와 통합 — User-level (L05)

### TDD 테스트
- `memory-extractor.test.ts` — 다양한 메시지에서 카테고리 분류 정확도
- `memory-retriever.test.ts` — pin 우선 + recency
- prompt eval test — 메모리가 일반 텍스트보다 우선되는지

### Gate
- 메모리가 prompt 의 별도 섹션 (`## 영구 사용자 지시사항`) 으로 주입됨
- 사용자가 메모리 삭제 시 다음 세션 prompt 에서 제외

---

## Phase 8 · Week 9 — Skills & MCP

**목표**: 스킬 시스템 + MCP 통합 + 사내 도구 등록.

### 구체 작업
- 마이그레이션 0009: mcp_servers + skill_assets
- skills 디렉토리 구조 + SKILL.md 자동 로딩
- tools/skills-engine.ts
- mcp/{mcp-bridge, mcp-client-pool, url-validator (SSRF), mcp-tool-adapter}
- routes/{skills, skill-assets, mcp-servers}.ts
- web/settings/{skills, mcp} UI
- {{BRAND_PPTX_SKILL_NAME}} 첫 스킬 작성 (T5)

### TDD 테스트
- `skills-engine.test.ts` — SKILL.md 파싱 + 활성화
- `lint-skills.test.ts` — semver 검증 (L09)
- `mcp-bridge.test.ts` — 도구 발견 + 등록
- `url-validator.test.ts` — RFC-1918 차단 + VPC CIDR 화이트리스트 (SSRF)
- `mcp.rate-limit.test.ts` — quota 적용 (L16)

### Gate
- 새 MCP server 등록 후 30초 안에 도구 자동 발견
- SSRF 시도 (`http://10.0.0.1/...`) → 차단

---

## Phase 9 · Week 10-12 — Quota / Ops / Polish / Release

**목표**: 운영 준비, polish, v1.0 GA.

### Week 10 — Quota & Observability
- 마이그레이션 0010, 0011
- quota-service + usage-logger + tool-metrics
- routes/{quota, usage, errors}.ts + admin/health
- 구조화 로그 + 카테고리/레벨 (L07)
- CloudWatch alarm setup
- admin 대시보드 (web/admin/)

### Week 11 — Polish & Bug bash
- 모든 팀이 backlog 정리
- 통합 e2e 테스트 (Playwright)
- Performance test (`pnpm load:100` ~ `load:1000`)
- A11y audit (a11y-reviewer agent)
- 보안 audit (security-reviewer agent)
- 문서 한 번 더 정리 (CLAUDE.md, AGENTS.md, README.md)

### Week 12 — Release
- v1.0-rc1 staging 배포 + 사내 베타 (5명)
- 베타 피드백 → 수정 → v1.0-rc2
- v1.0 GA 배포 (production)
- 회고 미팅 + lessons → `docs/decisions/` 자동 ADR 생성

### Gate (v1.0 GA 조건)
- [ ] 모든 phase 의 acceptance test 통과
- [ ] Coverage server ≥ 80%, web ≥ 60%
- [ ] p95 응답 시간 < 500ms (LLM 제외)
- [ ] 24시간 staging soak (오류 0)
- [ ] 보안 audit 통과 (semgrep + trivy)
- [ ] CHANGELOG.md + release note 작성
- [ ] `docs/decisions/INDEX.md` 가 모든 ADR 포함

---

## Sprint key 매핑 (L01 / Phase ↔ S<NN>)

각 phase 의 sprint key (commit/MR title 에 사용):

| Phase | 기간 | Sprint key prefix | 예시 |
|---|---|---|---|
| 0 셋업 | Week 1 | `v1.0-S00-setup` | `feat(infra): pnpm + turbo 셋업 [v1.0-S00-setup]` |
| 0.5 Contract Bootstrap | Week 1 끝 | `v1.0-S00-contract` | `feat(interfaces): 12 contract + index.ts/types.ts/errors.ts (총 15 파일) + Zod schema freeze [v1.0-S00-contract]` |
| 1 Auth | Week 2 | `v1.0-S01-auth` | `feat(server): JWT refresh rotation [v1.0-S01-auth]` |
| 2 Session | Week 3 | `v1.0-S02-session` | |
| 3 Project | Week 4 | `v1.0-S03-project` | |
| 4 Knowledge | Week 5 | `v1.0-S04-knowledge` | |
| 5 Artifact | Week 6 | `v1.0-S05-artifact` | |
| 6 Share | Week 7 | `v1.0-S06-share` | |
| 7 Memory | Week 8 | `v1.0-S07-memory` | |
| 8 Skills | Week 9 | `v1.0-S08-skills` | |
| 9 Polish | Week 10-12 | `v1.0-S09-polish` / `v1.0-S09-release` | |

**본 표가 단일 출처**. 다른 문서들의 예시는 모두 본 표를 따른다 (00-CONTEXT.md / 10-DEV-WORKFLOW.md 등이 본 표 참조).

## Phase 3 visibility 매트릭스 (06 § 0015 RLS 와 단일 출처)

`projects.visibility` × `actor.role`. **non-member 는 same org_unit 여부로 분기** ([06 § 0015 projects_select policy](06-DATA-MODEL.md) 와 1:1):

| visibility \ actor | viewer (member) | editor (member) | owner (member) | non-member, same org_unit | non-member, same org (다른 org_unit) | other-org |
|---|---|---|---|---|---|---|
| `private` | read | read+write | read+write+admin | 404 | 404 | 404 |
| `team`    | read | read+write | read+write+admin | **read** (org_unit 매칭) | 404 (org_unit 불일치) | 404 |
| `org`     | read | read+write | read+write+admin | read | read | 404 |

**9 케이스** (3 visibility × 3 non-member 분기 + member 3 권한): RLS `projects_select` policy 가 본 표를 강제. Integration test 는 정확히 9 actor scenario 를 검증.

> **반복 질문 차단**: 라운드 22~25 검토에서 "sprint matrix 는 same-org read 인데 RLS 는 same org_unit 만" 가 반복 지적. **본 표가 단일 출처 — `team` 의 non-member 읽기는 same org_unit 필수**. v1.0 의 의도된 보안 경계 (팀 scope 가 org_unit 단위, "team=org 의 모든 사람" 이 아님).

## Phase 0 의 "30분 onboarding" 의 구체 절차

> **gate 정의 (Phase 0 vs Phase 1+ 분리)**: Phase 0 의 "30분 onboarding" 은 **인프라/툴체인 부트스트랩** 만 검증. 로그인/메시지 흐름은 Phase 1 (auth) + Phase 2 (sessions/messages) 통과 시점부터 acceptance 의무.

### Phase 0 acceptance (T1 Skeleton)
```
00:00  laptop 켜기
00:02  git clone https://{{GITLAB_HOST}}/{{GITLAB_GROUP}}/{{PROJECT_SLUG}}
00:03  bash scripts/setup-git.sh    → email 입력
00:04  pnpm install                  (캐시 hit 30s, miss 시 ~2분)
00:08  cp .env.local.example .env.local            # Phase 0 default (시나리오 B). secret stub 포함, 수정 불요.
       # 시나리오 A (SSM tunnel) 사용 시: cp .env.example .env.local + 받은 dev secrets 채움.
00:12  docker compose -f docker-compose.local.yml up -d --wait   # Phase 0 default. --wait: healthcheck 통과까지 block (db:migrate race 차단). 시나리오 A 면 'pnpm tunnel'.
00:14  pnpm db:migrate                  # 빈 schema (Phase 0) 또는 Phase 1+ 적용된 schema
00:16  pnpm dev                          # web:3000 + server:4000 (Node only — worker 는 Phase 4 부터)
00:18  curl http://localhost:4000/health  → {"status":"ok",...}
00:19  curl http://localhost:4000/api/v1/_ping  → {"data":{"ok":true},"meta":{...}}
00:21  http://localhost:3000 접속 → "{{PROJECT_NAME}}" 홈 페이지 표시 (login 화면은 Phase 1 부터)
00:25  pnpm typecheck && pnpm lint && pnpm test 모두 0 exit
00:30  완료 ✓
```

> **Phase 0 = Node only**. converter-worker (Python) 는 Phase 4 (Knowledge & RAG) 에서 처음 사용 — 그때 `cd apps/converter-worker && poetry install` + `pnpm dev:full`. Phase 0 onboarding 은 worker 의존 없음.

### Phase 1 + Phase 2 통합 acceptance (Magic-link signup + 채팅 응답)

Phase 1 (auth) 와 Phase 2 (sessions/messages) 가 모두 적용된 *이후* 의 onboarding test:
```
00:00  (Phase 0 끝난 repo + Phase 1/2 머지된 main)
00:05  pnpm db:migrate && pnpm db:seed   # organization + smoke 계정
00:07  http://localhost:3000/signup       # Phase 1 의 magic-link 가입
00:10  본인 이메일로 magic-link 받음 (EMAIL_SENDER_KIND=console 이면 stdout 에서 URL 복사)
00:12  /chat/<sessionId>                  # Phase 2 의 채팅 화면
00:15  test 메시지 보내고 SSE 응답 받음
00:20  완료 ✓
```

> Phase 0 acceptance 와 Phase 1+2 acceptance 는 **별개의 gate** — Phase 0 만으로는 magic-link/chat 동작 안 함 (의도된 boundary).

---

## 의존 관계 (DAG)

```
Phase 0 (셋업 — T1 Skeleton, 모든 팀 공동)
  └─→ Phase 0.5 (Contract Bootstrap PR — integration owner 단일 PR)
        │   ▶ branch: integration/phase-0.5
        │   ▶ MR target: main
        │   ▶ acceptance: pnpm typecheck/lint + openapi:generate + lint-plan.sh 0 exit
        │   ▶ merge 후에야 T1~T6 가 worktree 분기 (Phase 1+ 시작)
        ▼
  └─→ Phase 1 (Identity & Auth)
        └─→ Phase 2 (Session & Message)
              ├─→ Phase 3 (Projects)
              │     └─→ Phase 4 (Knowledge & RAG)
              │           └─→ Phase 5 (Artifacts)
              │                 └─→ Phase 6 (Share)
              │
              ├─→ Phase 7 (Memory) — Phase 2 만 필요, Phase 3 무관
              │
              └─→ Phase 8 (Skills & MCP) — Phase 2 + Phase 3 (mcp_servers.project_id → projects FK)
                                              │
              └──────────────┐                 │
                             ▼                 ▼
                        Phase 9 (Quota / Ops / Polish / Release)
```

T6 (Frontend) 은 모든 phase 와 병행 — phase 별 backend API 가 안정화되면 UI 추가. (07-AGENT-TEAMS § 6 도메인 팀 = T1~T6 단일 출처. "T7" 은 drift 였음.)

## 각 phase 의 acceptance test (요약)

| Phase | Acceptance test 핵심 |
|---|---|
| 0 | CI 3 pipeline 정상, 30분 onboarding |
| 1 | RLS: cross-org leak 0% |
| 2 | 메시지 SSE 정상, abort 즉시 중단 |
| 3 | visibility 매트릭스 9 케이스 통과 (§ Phase 3 visibility 매트릭스 단일 출처) |
| 4 | 4 포맷 indexing + citation 100% |
| 5 | artifact 10MB preview < 5s |
| 6 | 만료/revoke flow + 122-bit 토큰 |
| 7 | 메모리 prompt 우선순위 정상 |
| 8 | MCP discovery + SSRF 차단 |
| 9 | v1.0 GA gate 모두 통과 |

---

## Phase × Team 작업표 — 병렬 워크트리 단위 분해

> 각 셀 = "팀 N 이 Phase P 에서 자기 worktree 에 만들 PR 단위". 입력/출력/소유 파일/완료조건/integration 순서까지 명세. 한 팀이 그 셀만 보고도 PR 을 열 수 있게.

### Agent Task Packet 템플릿 (모든 셀에 적용)

서브에이전트에게 셀 하나를 할당할 때 다음 메타데이터를 함께 전달:

```yaml
# 셀: Phase N — Team T<N>
read_docs:           [build_prompt.md, 07-AGENT-TEAMS.md, 08-SPRINT-PLAN.md, 09-TDD-GUIDE.md, 10-DEV-WORKFLOW.md, <셀의 입력 doc>]
# 07 = team 매핑 / Phase 0.5 산출물 / worktree 운영 / shared-lock 정책
# 09 = TDD-first 규칙 (RED 만든 후 GREEN, refactor)
# 10 = MR rule, Tier A/B approval, husky hook, sprint key 형식
owned_paths:         [<팀별 소유 — 아래 표 참조>]
forbidden_paths:     [<팀별 금지 — 아래 표 참조>]
branch:              "t<N>-<team>/phase-<P>/<topic>"
base:                "integration/phase-<P>"
mr_target:           "integration/phase-<P>"
predecessor_pr:      "<선행 PR URL 또는 'Phase 0.5 머지 후'>"
ports:               [server=400<N>, web=300<N>, worker=800<N>]
acceptance_command:  "pnpm typecheck && pnpm lint && pnpm --filter ... test && bash docs/plans/scripts/lint-plan.sh"
codeowner:           "<해당 영역 CODEOWNERS section — 05-REPO-STRUCTURE.md § CODEOWNERS 와 1:1>"
# lint-plan.sh 의 실 경로:
#   - 원본 plan repo:  rebuild_plan/scripts/lint-plan.sh
#   - 새 repo 복사 후: docs/plans/scripts/lint-plan.sh
# lint-plan.sh 가 PLAN_DIR 자동 감지 (부모 디렉토리 기준). 새 repo 에선 docs/plans/ 안에서 실행.
sprint_key:          "v1.0-S<NN>-<phase-name>"
approval:            "Tier A (1 approval + CI)"
conflict_owner:      "<영역별 owner — 07 § Conflict resolution 표>"
```

#### 팀별 owned / forbidden 패턴 (Phase 1+ 공통)

| 팀 | owned_paths | forbidden_paths (위에 더해) |
|---|---|---|
| **T1 Platform** | `apps/server/src/db/migrations/**`, `apps/server/src/db/schema.ts`, `apps/server/src/db/{project-service,artifact-service,memory-service}.ts`, `apps/server/src/middleware/{auth,jwt,rls-context,rate-limit,request-context}.ts`, `apps/server/src/routes/auth.ts`, `apps/server/src/routes/projects.ts`, `apps/server/src/routes/mcp-servers.ts`, `apps/server/src/lib/email-sender.ts`, `apps/server/src/tools/sandbox/**`, `apps/server/src/mcp/**`, `infra/**`, `scripts/**` | `apps/server/src/{orchestrator,knowledge,tools/handlers}/**`, `apps/server/src/lib/{errors,envelope}.ts` (Phase 0.5 owned), `apps/server/src/middleware/envelope.ts` (Phase 0.5 owned), `apps/web/**` |
| **T2 Orchestrator** | `apps/server/src/orchestrator/**`, `apps/server/src/routes/{sessions,messages,memories}.ts`, `apps/server/src/tools/handlers/**` | `apps/server/src/db/migrations/**`, `apps/server/src/db/schema.ts`, `apps/server/src/openapi.ts`, `packages/shared/**`, `packages/interfaces/**`, `apps/web/**` |
| **T3 Knowledge** | `apps/server/src/knowledge/**`, `apps/server/src/routes/{uploads,documents}.ts` | (T2 동일 + `apps/server/src/orchestrator/**`) |
| **T4 Artifact** | `apps/server/src/routes/{artifacts,artifact-shares,public-share}.ts`, `apps/server/src/lib/artifact-store.ts`, `apps/web/src/components/artifacts/**` (T6 와 공동) | T2 동일 ⚠️ 단 `apps/web/**` 전체 forbidden 에서 `apps/web/src/components/artifacts/**` 는 명시 예외 |
| **T5 Skills** | `skills/**`, `apps/server/src/tools/skills-engine.ts`, `apps/server/src/routes/{skills,skill-assets}.ts` | (T2 동일) |
| **T6 Frontend** | `apps/web/src/**` (단 `components/artifacts/**` 는 T4 와 공동) | `apps/server/**`, `packages/**`, `apps/converter-worker/**` |

**공통 forbidden** (모든 팀): `packages/shared/**`, `packages/interfaces/**`, `apps/server/src/openapi.ts`, `apps/server/scripts/generate-openapi.ts`, `apps/server/src/lib/errors.ts`, `apps/server/src/middleware/envelope.ts`, `apps/web/src/lib/{api-client,api-types.generated}.ts`, `.gitlab/CODEOWNERS`, `.github/**`, `tsconfig.base.json`, `eslint.config.mjs` — Phase 0.5 의 Contract Bootstrap PR (PR author = integration owner) 만 작성/수정. 후속 변경은 Tier B 승인 필요.

> **Phase 0.5 Contract Bootstrap PR 의 owned_paths (단일 출처 — [07 § Phase 0.5 산출물 표](07-AGENT-TEAMS.md) 와 정확히 동일)**:
> ```
> /packages/shared/**
> /packages/interfaces/**
> /apps/server/src/openapi.ts
> /apps/server/scripts/generate-openapi.ts
> /apps/server/src/lib/errors.ts                       # ErrorRegistry + AppError
> /apps/server/src/middleware/envelope.ts              # envelope enforcer
> /apps/web/src/lib/api-client.ts
> /apps/web/src/lib/api-types.generated.ts             # openapi → 자동 생성 (커밋 포함)
> /.gitlab/CODEOWNERS
> ```
> PR author: integration owner (RC, 1 명). 다른 팀 직접 commit 금지. `approval`: Tier B (7 owner 승인 — section 별).
> 본 owned_paths 가 [07 § Phase 0.5 산출물 표](07-AGENT-TEAMS.md) 8 행과 1:1 매핑. lint § 30 가 자동 검증.

### Phase 1 (Auth, Week 2)

| 팀 | 입력 계약 | 소유 파일 | 출력 / mock | 완료 조건 |
|---|---|---|---|---|
| **T1 Platform** | 06-DATA-MODEL § 0001/0012/0013, 16 § /auth/* | `apps/server/src/db/migrations/0001*.sql`, `0012*.sql`, `0013*.sql`, `routes/auth.ts`, `middleware/{auth,jwt,rls-context}.ts`, `lib/email-sender.ts` (Console/Ses/Smtp) | `EmailSender` instances, JWT util, magic-link verify | RLS test (cross-org 0 leak) + magic-link signup → login flow e2e |
| **T2 Orchestrator** | (Phase 2 진입 전 mock 만) | — | `interfaces/LLMProvider` mock impl | (Phase 2 시작) |
| **T3 Knowledge** | — | — | — | (Phase 4 시작) |
| **T4 Artifact** | — | — | — | (Phase 5 시작) |
| **T5 Skills** | — | — | — | (Phase 8 시작) |
| **T6 Frontend** | 18-FRONTEND § /login, /signup wireframe (verify 페이지 없음 — server 302) | `apps/web/src/app/(auth)/{login,signup}/*` | login/signup pages | dev 서버에서 magic-link 가입 흐름 표시 (server 302 → `/`, 홈에서 새 세션 생성 후 `/chat/<id>`) |

**Integration 순서 (Phase 1 end)**: T1 PR → integration/phase-1 → T6 PR → integration/phase-1 → e2e smoke (CI auto) → fast-forward main.

### Phase 2 (Session/Message Flow, Week 3)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0002/0003 | `migrations/0002*.sql`, `0003*.sql`, `db/active-runs-service.ts` (DB layer 만) | DDL + active_runs CRUD | RLS test + active_runs status enum 전이 |
| **T2** | 14 § orchestrator, 17 § base prompt | `apps/server/src/orchestrator/**`, `apps/server/src/routes/{sessions,messages}.ts` (공통 ownership 표 일치) | LLM 호출 루프 + prompt builder + abort + SSE 응답 | "hello" → SSE text_delta + stop |
| **T3** | — | — | — | (Phase 4) |
| **T6** | 18 § /chat/[sessionId] | `apps/web/src/app/(chat)/*`, `hooks/useSessionStream.ts` | 채팅 UI + SSE 소비 + Stop | dev 에서 SSE 흐름 + Stop 즉시 중단 |

**Integration**: T1 (DDL) → T2 (orchestrator + routes/{sessions,messages}.ts) → T6 (UI).
> routes/{sessions,messages}.ts 는 **T2 단독 owner** (공통 ownership 표). T1 은 DB layer 만 (active_runs CRUD service).

### Phase 3 (Projects & Members, Week 4)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0004/0015 + bootstrap_project_owner | `migrations/0004*.sql`, `0015*.sql`, `routes/projects.ts`, `db/project-service.ts` | POST /projects (owner row 자동 생성) | visibility matrix 9 케이스 통과 (§ Phase 3 visibility 매트릭스 단일 출처) |
| **T6** | 18 § /projects, /projects/[id] | `apps/web/src/app/projects/*` | project list + 상세 | visibility=team 가 다른 org 에서 404 |

### Phase 4 (Knowledge & RAG, Week 5)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0005/0014 | `migrations/0005*.sql`, `0014*.sql` (DDL 만) | DDL + RLS | document_chunks RLS 통과 |
| **T3** (routes 도 같이) | 16 § /uploads, /projects/:id/documents | `apps/server/src/routes/{uploads,documents}.ts` (T3 owner — 공통 ownership 표) | upload + document CRUD | API 통과 |
| **T3** | 14 § EmbeddingProvider, 17 § knowledge_search | `apps/server/src/knowledge/*` | parser-pipeline + chunker + embedding + search | 4 포맷 indexing + citation |
| **T6** | 18 § /projects/[id]/documents/upload modal | `apps/web/src/app/projects/[id]/documents/*` | upload UI + indexing progress | dev 에서 파일 업로드 → indexed |

### Phase 5 (Artifact, Week 6)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0006 artifacts (storageKind inline/s3 분기, CHECK 제약) | `migrations/0006*.sql`, `db/artifact-service.ts` | DDL + ArtifactRepo Drizzle 구현 + CHECK 마이그레이션 dry-run | RLS test (session_id NULL OK, cross-user 404) |
| **T4** | 14 § ArtifactStore, 16 § /artifacts/:id (storageKind inline\|s3) | `routes/artifacts.ts`, `lib/artifact-store.{inline,s3}.ts` | `ArtifactStore` 두 구현, 256KB 임계치 자동 분기, presigned URL 60s | 10MB pptx upload → s3, 100KB md → inline. preview < 5s |
| **T6** | 18 § ArtifactContext (참조) | `apps/web/src/components/artifacts/` (T4 와 공동) | viewer (mime 별 분기: image/pdf inline iframe, 그 외 download) | dev 에서 chat 응답의 artifact 클릭 → viewer 패널 |

**Integration**: T1 (DDL) → T4 (server route + ArtifactStore) → T6 (viewer). T4/T6 의 `components/artifacts/` 는 CODEOWNERS 공동.

### Phase 6 (Share, Week 7)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0007 artifact_shares (122-bit token, expires_at, view_count) | `migrations/0007*.sql` | DDL + ArtifactShareRepo | 만료/revoke RLS test |
| **T4** | 16 § /artifacts/:id/share, /share/:token (authMiddleware 전 mount) | `routes/{artifact-shares,public-share}.ts` | POST share / GET shares / DELETE revoke / GET public share | 122-bit unguessable, 410 GONE on expired/revoked |
| **T6** | 18 § /share/[token] 와이어프레임 | `apps/web/src/app/share/[token]/page.tsx` | 익명 페이지 (인증 우회), 만료/revoked 상태 화면 | 만료 url 클릭 → 410 페이지 |

### Phase 7 (Memory, Week 8)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0008 user_memories + memory_extraction_locks | `migrations/0008*.sql` | DDL + UserMemoryRepo + extraction lock 메커니즘 | Redis distributed lock test (concurrent extraction 안전) |
| **T2** | 17 § memory extractor / retriever 알고리즘 | `orchestrator/{memory-extractor,memory-retriever}.ts` | 4 카테고리 추출 + retrieval 우선순위 | "사용자가 ___ 좋아한다" 패턴 추출 + prompt 에 pin |
| **T6** | 18 § /settings/memories | `apps/web/src/app/settings/memories/*` | UserMemory CRUD UI | dev 에서 memory 추가/수정/pin/삭제 |

### Phase 8 (Skills & MCP, Week 9~10)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0009 mcp_servers (FK projects 의존 — Phase 3 끝나야 함) + skill_assets | `migrations/0009*.sql`, `routes/mcp-servers.ts` | DDL + MCP discovery endpoint + SSRF 가드 | 사내 IP 차단 + 외부 MCP 발견 |
| **T5** | 14 § SkillRegistry, 17 § SKILL.md frontmatter | `apps/server/src/tools/skill-registry.ts`, `skills/_template/` | semver 로딩, 4 scope (org/project/user/global), MCP 어댑터 | SKILL.md 잘못된 frontmatter → reject + 명확한 에러 |
| **T6** | 18 § /settings/{skills,mcp} | `apps/web/src/app/settings/{skills,mcp}/*` | 카드 목록 + MCP 추가 modal | skills list + MCP 등록 시 discovery 성공 표시 |

### Phase 9 (Quota / Ops / Polish, Week 11~12)

| 팀 | 입력 | 소유 | 출력 | 완료 |
|---|---|---|---|---|
| **T1** | 06 § 0010/0011/0016 + 12 § alarms | `migrations/0010,0011,0016*.sql`, `lib/{alert-engine,health-checker,data-retention}.ts`, alarms config | DDL + quota gate + alert SNS → Slack + data retention cron | quota 90% 경고 + 100% 차단 + alarm slack 발송 |
| **T6** | 18 § /admin/* (3 화면) | `apps/web/src/app/admin/*` | dashboard, users 관리, tool-metrics | admin role 만 접근 + role 변경 / suspend 동작 |
| **모든 팀** | v1.0 GA gate checklist (08 § Phase 9) | (각 팀 기존 책임 영역의 polish) | bug fixes, perf, observability 보강 | 9개 phase 의 acceptance test 전체 통과 |

> 본 표 (Phase 1~9) 가 07-AGENT-TEAMS § Merge sequencing 의 단일 출처. 각 Phase 끝에서 RC 가 통합 → main fast-forward.
> 빈 셀 ("—") 은 해당 팀이 그 phase 에서 mock/stub 만 유지 — 다음 phase 진입 전 추가 작업 없음.

# 04 · Tech Stack — 기술 선택 및 근거

원본 source project 의 선택을 대부분 유지하되, [01-LESSONS-LEARNED.md](01-LESSONS-LEARNED.md) 의 18개 lesson 을 반영한 옵션은 명시.

## 언어 / 런타임

| 항목 | 선택 | 버전 | 근거 |
|---|---|---|---|
| **언어** | TypeScript (strict) | 5.x | end-to-end 타입, packages/shared 로 contract 공유 |
| **Node 런타임** | Node.js | 22 LTS | native fetch, modern ESM, perf 향상 |
| **패키지 매니저** | pnpm | 10.x | content-addressable store, monorepo 효율 |
| **Monorepo 도구** | Turborepo | 2.x | task DAG + remote cache |
| **Python** | (옵션) 3.12 | converter-worker 안에서만 | python-pptx / python-docx / openpyxl |

## 백엔드

| 항목 | 선택 | 근거 |
|---|---|---|
| **HTTP framework** | Hono | TypeScript-first, 가볍고 빠름, 미들웨어 체이닝 우수 |
| **ORM** | Drizzle | typed SQL, migration 도구 (drizzle-kit) |
| **Validation** | Zod | runtime + compile-time 타입, 에러 메시지 한국어 가능 |
| **로깅** | Pino | JSON 구조화, 빠름, transports 다양 |
| **이벤트/job** | BullMQ (Redis) | Redis 기반 큐, retry/dead-letter 지원 |
| **WebSocket / SSE** | Hono streaming + native EventSource | SSE 가 단순하고 LB friendly |

## 프론트엔드

| 항목 | 선택 | 근거 |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | React 19, server components, edge 가능 |
| **UI 라이브러리** | React 19 | 표준, ecosystem |
| **상태관리** | React Context + URL state | 작고 단순, Redux 도입 안 함 |
| **Style** | Tailwind CSS v4 | utility-first, design token PostCSS |
| **컴포넌트** | shadcn/ui (선택), custom primitives | un-opinionated, 변경 자유로움 |
| **Markdown 렌더링** | react-markdown + remark/rehype plugins | citation 플러그인 작성 가능 |
| **PDF 렌더링** | react-pdf + pdfjs-dist | 표준 |
| **Chat UI 베이스** | (옵션) assistant-ui 사용, streaming 호환 |
| **PPTX 미리보기** | converter-worker → PDF → react-pdf | LibreOffice 변환 |

## 데이터

| 항목 | 선택 | 근거 |
|---|---|---|
| **RDBMS** | PostgreSQL | 16 | RLS, pgvector, jsonb 풍부 |
| **벡터** | pgvector | 0.7+ | 단일 DB로 정형 + 벡터 통합 |
| **Full-text** | postgres + pg_trgm + tsvector | bm25 는 paradedb 또는 직접 구현 |
| **Cache / Lock** | Redis | 7 | session lock, HITL queue, rate limit |
| **Object store** | AWS S3 | uploads + artifacts |
| **Search ranking** | RRF (Reciprocal Rank Fusion) | 벡터 + bm25 결합 |

## AI / LLM

| 항목 | 선택 | 근거 |
|---|---|---|
| **Primary LLM** | Anthropic Claude (Opus/Sonnet) | tool use, prompt caching 우수 |
| **Fallback LLM** | OpenAI GPT (4o, o-series), Gemini | provider failover |
| **임베딩** | Voyage AI `voyage-multilingual-2` (dim=1024) | 한국어 품질, v1.0 단일 결정 (14-INTERFACES.md §5) |
| **이미지 캡션** | Google Gemini (Pro Vision) | PDF/PPTX 이미지 → 텍스트 |
| **Web search** | Tavily | API 안정, citation 친화 |
| **Sandbox** | E2B | 격리 + 확장성 (L11) |

## 인프라 (AWS)

| 항목 | 선택 | 근거 |
|---|---|---|
| **Compute (web)** | ECS Fargate | stateless, 자동 scale |
| **Compute (server)** | ECS Fargate (E2B 사용 후) | Docker socket 불필요 |
| **Compute (worker)** | ECS Fargate | converter-worker |
| **DB** | RDS PostgreSQL Multi-AZ | managed, automated backup |
| **Cache** | ElastiCache Redis | managed cluster |
| **LB** | ALB | path-based routing, target group health |
| **Object** | S3 | encryption at rest |
| **Secrets** | AWS Secrets Manager | IAM 통합 |
| **DNS** | Route 53 | health check 통합 |
| **CDN** | CloudFront (옵션) | 정적 자산 |
| **Container registry** | ECR | IAM 통합 |
| **Service discovery** | Cloud Map (옵션) | worker 간 discovery |
| **Observability** | CloudWatch Logs + Metrics + Alarms | managed |
| **Trace** | X-Ray (옵션) | OpenTelemetry SDK |

## 개발 도구

| 항목 | 선택 | 근거 |
|---|---|---|
| **Test runner** | Vitest | Vite 호환, 빠름 |
| **E2E test** | Playwright | 크로스 브라우저 |
| **Lint** | ESLint v9 (flat config) | typescript-eslint |
| **Format** | Prettier | 일관성 |
| **Type check** | tsc --noEmit | strict |
| **Git hooks** | Husky + lint-staged | pre-commit / commit-msg |
| **Schema migration** | drizzle-kit | typed |
| **OpenAPI** | (옵션) hono/zod-openapi | client typed gen |

## CI/CD

| 항목 | 선택 | 근거 |
|---|---|---|
| **CI** | GitLab CI (사내 GitLab) | 같은 플랫폼 통합 |
| **Container build** | docker buildx (multi-arch) | linux/amd64 강제 |
| **Image scan** | trivy | container CVE |
| **Code scan** | semgrep | OWASP |
| **Secret scan** | gitleaks | pre-commit + CI |
| **Deploy automation** | shell script + AWS CLI (CI 호출만) | 단순 |

## 대안 비교 (선택하지 않은 것들과 이유)

| 영역 | 대안 | 선택하지 않은 이유 |
|---|---|---|
| Framework (server) | Fastify, Express, NestJS | Hono 가 더 가볍고 TypeScript native |
| Framework (web) | Remix, SvelteKit | Next.js 가 React/생태계 우위 |
| ORM | Prisma, Knex, TypeORM | Drizzle 가 SQL-first, lockfile 없음 |
| State (web) | Redux, Zustand, Jotai | 우리 규모에 context 로 충분 |
| Vector DB | Pinecone, Qdrant, Weaviate | pgvector 가 단일 DB 운영 비용 절감 |
| Sandbox | Docker socket, Firecracker 직접 | E2B 가 운영 부담 없음 (L11) |
| Queue | SQS, RabbitMQ | BullMQ + Redis 가 이미 있는 redis 재사용 |
| Embedding | OpenAI, Cohere | Voyage 한국어 + 비용 |
| Log | Winston, console | Pino 가 빠르고 구조화 |

## 버전 / 의존성 정책

- 모든 의존성은 root `package.json` 의 `pnpm.overrides` 로 single version (L04)
- 메이저 업그레이드는 ADR 의무 (별도 MR + spike)
- 보안 패치는 Renovate 가 자동 PR
- node_modules 는 pnpm cache 사용 (CI build 시간 단축)

# 07 · Agent Teams — 서브에이전트/팀 분담 및 병렬 개발

> 본 plan 의 v2 는 **사람 개발자 + AI 서브에이전트** 가 한 팀으로 일한다. 도메인별 6개 팀이 병렬로 진행하며, packages/shared & interfaces 가 동기화 포인트.

## 두 종류의 "Agent"

1. **사람 개발자가 속한 도메인 팀** (Human + AI 협업) — 도메인별 분담
2. **Claude Code 서브에이전트** (자동화 도우미) — 팀 내부에서 도구로 사용

## 6개 도메인 팀

| 팀 | 책임 영역 | 디렉토리 | 산출물 |
|---|---|---|---|
| **T1. Platform** | 인프라/CI/CD/Sandbox/MCP/공통 | `infra/`, `apps/server/src/{tools/sandbox,mcp,lib}/`, scripts | E2B integration, CI pipeline, ops 대시보드 |
| **T2. Orchestrator** | LLM 호출 루프, prompt builder, memory, abort 흐름 | `apps/server/src/orchestrator/` | message processing, memory system, HITL |
| **T3. Knowledge** | RAG (parser/chunk/embed/search) | `apps/server/src/knowledge/` | hybrid search, citation, document indexing |
| **T4. Artifact** | artifact 서버 로직 + UI 컴포넌트 | `apps/server/src/routes/{artifacts,artifact-shares,public-share}.ts` + `apps/web/src/components/artifacts/` (T6 와 공동, CODEOWNERS 분담) | PPTX/PDF renderer, share link |
| **T5. Skills** | 스킬 시스템, {{BRAND_PPTX_SKILL_NAME}} 등 사용자 스킬 | `skills/`, `apps/server/src/tools/skills-engine.ts` | SKILL.md 로딩, semver, skill marketplace |
| **T6. Frontend** | UI shell + chat/project/settings/admin (artifact 컴포넌트 제외) | `apps/web/src/` (단 `components/artifacts/` 는 T4 와 공동) | Next.js pages, hooks, design system |

**도메인 간 인터페이스**:
- 모든 팀이 `packages/shared` 의 타입을 사용 (단방향, 양도 없음)
- 모든 팀이 `packages/interfaces` 의 인터페이스를 import 하고 자기 구현 제공
- 팀간 새 인터페이스 변경은 **모든 팀의 + 팀장의 approval 필요** (PR template + CODEOWNERS)

## 각 팀의 Claude Code 서브에이전트

각 팀은 다음 4종의 Claude Code 서브에이전트를 활용:

### A. `domain-architect` (팀당 1개)
- 역할: 그 도메인의 큰 그림 유지, 새 MR 의 도메인 적합성 review
- 발동: PR 생성 시 자동 코멘트, 도메인 외 import 검출
- 출력: review 코멘트, 회피 패턴 제안

### B. `tdd-pair` (모든 팀 공유)
- 역할: TDD RED → GREEN → REFACTOR 흐름 안내
- 발동: 사용자가 "TDD 로 X 만들어줘" 요청
- 출력: 실패하는 테스트 먼저 → 최소 구현 → 리팩토링

### C. `code-reviewer` (모든 PR 자동)
- 역할: PR diff 자동 리뷰 → 점수 + 코멘트
- 발동: PR 머지 시도 시 자동 CI 단계
- 출력: 점수 < 7 이면 머지 차단 (L10)

### D. `doc-keeper` (팀당 1개, 비동기)
- 역할: PR description → `docs/decisions/` ADR md 자동 생성
- 발동: PR 머지 webhook
- 출력: 새 ADR PR

## Claude Code 서브에이전트 위치

```
.claude/agents/
├── shared/
│   ├── tdd-pair.md
│   ├── code-reviewer.md
│   └── security-reviewer.md
├── platform/
│   ├── ci-fixer.md
│   ├── infra-architect.md
│   ├── sandbox-debugger.md
│   └── mcp-debugger.md
├── orchestrator/
│   ├── prompt-tuner.md
│   ├── abort-flow-checker.md
│   └── memory-extractor-trainer.md
├── knowledge/
│   ├── chunker-tuner.md
│   ├── citation-checker.md
│   └── embedding-cost-analyzer.md
├── artifact/
│   ├── renderer-tester.md
│   └── share-security-reviewer.md
├── skills/
│   ├── skill-validator.md       # SKILL.md frontmatter 검증
│   └── semver-enforcer.md
├── frontend/
│   ├── a11y-reviewer.md
│   ├── ui-tester.md
│   └── tailwind-tidier.md
└── doc-keepers/
    └── adr-generator.md
```

## 병렬 개발의 동기화 포인트

```
                      ┌─────────────────────────┐
                      │ packages/shared (타입)   │
                      │ packages/interfaces      │
                      └────────────┬─────────────┘
                                   │
        ┌────────────┬─────────────┼─────────────┬────────────┬───────────┐
        ▼            ▼             ▼             ▼            ▼           ▼
   ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌──────┐  ┌──────────┐
   │   T1    │  │   T2    │  │   T3     │  │   T4    │  │  T5  │  │   T6     │
   │Platform │  │Orches-  │  │Knowledge │  │Artifact │  │Skills│  │Frontend  │
   │         │  │trator   │  │          │  │         │  │      │  │          │
   └────┬────┘  └─────────┘  └──────────┘  └─────────┘  └──┬───┘  └────┬─────┘
        │            ▲                                       │           │
        │            │ tool                                  │           │
        ▼            │ contracts                             ▼           ▼
    Sandbox  ←───────┴─── tool-router ────► Skill SKILL.md  Skill marketplace
    MCP                                                                    UI
                                                                           │
                                                                           ▼
                                                                       SSE/REST
```

핵심 동기화 룰:
- **shared/interfaces 변경**: 같은 PR 안에서 **모든 구현 패키지 typecheck 통과** (turbo 의 dependency graph)
- **API contract** 변경: server 의 OpenAPI/zod 스키마와 web 의 client 가 같은 commit 에 정합 (CI 의 `api-contract-check` job)
- **DB 스키마 변경**: migration PR 은 동일 PR 안에서 server typecheck + service test 통과

## 팀별 첫 1주 (week 0) 셋업

각 팀이 첫 주에 만들어야 할 산출물 (Phase 0):

### T1 Platform
- `infra/aws/terraform/` (옵션) — VPC, RDS, Redis, ECS skeleton
- `infra/aws/setup-infra.sh` — 신규 환경 1-shot 구축
- `.gitlab-ci.yml` 의 PR/main/release pipeline
- `.husky/*` hooks (identity, sprint-key)
- `scripts/{setup-git,tunnel,audit-deps}.sh`

> **Phase 0 (Week 0~1) 의 packages/interfaces / packages/shared 본문 작성 금지** — Phase 0.5 의 Contract Bootstrap PR (integration owner 단일) 이 12 contract + index.ts/types.ts/errors.ts (총 15 파일) + Zod schema 를 일괄 작성. 본 § 의 T2~T5 항목은 Phase 1+ 의 자기 도메인 코드 (`apps/server/src/{orchestrator,knowledge}/...`) 만 작성 — packages/* 는 import 만.

### T2 Orchestrator (Phase 1+ 의 자기 도메인 작업)
- `apps/server/src/orchestrator/orchestrator.ts` skeleton
- `apps/server/src/orchestrator/prompt-builder.ts` 4계층 enum
- `LLMProvider` interface 는 Phase 0.5 가 `packages/interfaces/LLMProvider.ts` 에 작성 — T2 는 import 만.

### T3 Knowledge (Phase 4+)
- `apps/server/src/knowledge/parser-pipeline.ts` skeleton
- Mock parser/embedding for tests
- `EmbeddingProvider` interface 는 Phase 0.5 작성 — T3 는 import.

### T4 Artifact (Phase 5+)
- `apps/server/src/db/artifact-service.ts` skeleton
- artifact_shares 스키마 결정 (T1 Platform 과 협의 — migration 본문은 T1 작성)
- `ArtifactStore` interface 는 Phase 0.5 작성.

### T5 Skills (Phase 8+)
- `skills/_template/` (스킬 작성 템플릿)
- `scripts/lint-skills.ts` (Phase 0 산출물 — Phase 0 매트릭스에 명시)
- `SkillSpec` 타입은 Phase 0.5 가 `packages/shared/src/schemas/skill.ts` 에 작성 (Zod). `types/skill.ts` 는 `z.infer<typeof SkillSpec>` 만 re-export.

### T6 Frontend
- `apps/web/src/app/layout.tsx`
- Tailwind v4 setup + design tokens
- `lib/api-client.ts` (typed)
- 기본 routing 골격

## 팀 간 충돌 발생 시 절차

1. **인터페이스 변경 PR 은 먼저 RFC** — `docs/rfc/<date>-<topic>.md` 짧은 토론 문서.
2. RFC 가 1주 동안 다른 팀 코멘트 받음. 답 없으면 기본 승인.
3. 변경 PR 은 모든 영향 받는 팀의 CODEOWNERS 승인 필요.

## 병렬 워크트리 운영 규칙 (서브에이전트가 따라야 할 실행 절차)

각 서브에이전트가 제한된 컨텍스트로 독립 작업할 때 drift 를 막기 위한 단일 출처.

### Phase 0.5 — Contract Bootstrap PR (병렬 분기 직전 단일 PR)

> **목적**: T2~T6 가 병렬로 분기하기 전에, 공유 contract 를 integration owner 가 단일 PR 로 먼저 머지. 이후 팀별 worktree 는 이 contract 만 import 하므로 첫 주부터의 drift 가 차단됨.
>
> **author vs approval (반복 질문 차단)**:
> - **PR author = integration owner (RC) 1 명**. 다른 팀은 본 PR 의 코멘트만, 직접 commit 금지. → "단독 PR / 단일 owner" 의 의미.
> - **Merge approval = Tier B (CODEOWNERS section 7 owner 모두 + agent-reviewer 통과)**. 작성자가 1 명이라도 merge gate 는 다인 승인 — 두 layer 가 모순이 아니라 협동.
> - 본 plan 의 다른 라운드 LLM 검토에서 "단일 owner vs 7-owner approval 충돌" 이 반복 지적되는데, **author 와 approval 은 별개 게이트**.

본 PR 의 산출물 (Phase 0 끝 ~ Phase 1 분기 전):

| # | 산출물 | source doc |
|---|---|---|
| 1 | `packages/interfaces/src/*.ts` — 15 파일 (12 contract + index.ts barrel + types.ts + errors.ts) | [14-INTERFACES § 파일 분할](14-INTERFACES.md) |
| 2 | `packages/shared/src/schemas/*.ts` — Zod schema 단일 출처 + `packages/shared/src/types/*.ts` (z.infer<> re-export) | [16-API-CONTRACT § 부록 A](16-API-CONTRACT.md). 단일 출처 = `schemas/`, `types/` 는 z.infer<> reflect. build_prompt § Phase 0.5 와 동일. |
| 3 | `apps/server/src/openapi.ts` (빌더 stub) + `apps/server/scripts/generate-openapi.ts` (CLI) | [16-API-CONTRACT § OpenAPI 생성](16-API-CONTRACT.md) |
| 4 | `apps/web/src/lib/api-client.ts` + `api-types.generated.ts` (server openapi 로부터 생성) | [16 § 클라이언트 사용 패턴](16-API-CONTRACT.md) |
| 5 | `apps/server/src/lib/errors.ts` (ErrorRegistry + AppError class) | [14-INTERFACES § Logger / errors](14-INTERFACES.md) |
| 6 | `apps/server/src/middleware/envelope.ts` (envelope enforcer) | [16 § envelope 자동 검증](16-API-CONTRACT.md) |
| 7 | `.gitlab/CODEOWNERS` (T1~T6 + interfaces/shared lock) | [05-REPO-STRUCTURE § CODEOWNERS](05-REPO-STRUCTURE.md) |
| 8 | `08-SPRINT-PLAN § Phase × Team 작업표` 의 ChatEvent union, storageKind enum, ProjectDocumentRecord 같은 inter-team 계약 freeze | [08-SPRINT-PLAN § Phase × Team](08-SPRINT-PLAN.md) |

본 PR 머지 후에야 T2~T6 가 각자 worktree 를 분기. 본 PR 의 변경은 이후 RFC + 7-owner-approval 정책 적용 (§ shared/interface lock).

### Branch / worktree 명명

| 자원 | 패턴 | 예 |
|---|---|---|
| 브랜치 | regex `^t[1-6]-(platform\|orchestrator\|knowledge\|artifact\|skills\|frontend)/phase-(0\.5\|[1-9])/[a-z0-9][a-z0-9-]{1,40}$` | `t1-platform/phase-1/identity-rls`, `t6-frontend/phase-3/projects-page` |
| worktree 디렉토리 | `../<repo>-wt/<team>-<topic>` | `../{{PROJECT_SLUG}}-wt/t1-identity-rls` |
| 통합 브랜치 | `integration/phase-<N>` | `integration/phase-1` — 팀별 branch 가 머지 모임 후 main 으로 fast-forward |

### `git worktree` 셋업

```bash
# Phase N 시작 시 RC 가 먼저 main 에서 `integration/phase-N` 생성·push.
# 각 팀은 그 branch 에서 worktree 분기 (`origin/integration/phase-N` 기준).
# Phase 0.5 만 예외: integration owner 가 `integration/phase-0.5` 를 main 에서 직접 생성.
git fetch origin
git worktree add ../{{PROJECT_SLUG}}-wt/t1-identity-rls -b t1-platform/phase-1/identity-rls origin/integration/phase-1
cd ../{{PROJECT_SLUG}}-wt/t1-identity-rls
pnpm install         # 별도 node_modules — pnpm content-addressable store 로 공간 효율
```

### 포트 / env 분리 (동시 실행 시)

각 팀이 동시에 `pnpm dev` 띄울 수 있도록 포트 범위를 미리 분리.

| 팀 | server | web | converter-worker |
|---|---|---|---|
| T1 Platform | 4001 | 3001 | 8001 |
| T2 Orchestrator | 4002 | 3002 | 8002 |
| T3 Knowledge | 4003 | 3003 | 8003 |
| T4 Artifact | 4004 | 3004 | 8004 |
| T5 Skills | 4005 | 3005 | 8005 |
| T6 Frontend | 4006 | 3006 | 8006 |
| integration | 4000 | 3000 | 8000 |

> **단일 출처**: T1~T6 의 책임 영역 (본 문서 § 6개 도메인 팀 표) 와 위 포트 표가 일치해야 함. 이전 버전의 "T3 Tools / T4 Knowledge" 표기는 drift — T3=Knowledge, T4=Artifact 가 정답. 08-SPRINT-PLAN 의 "T7 Frontend" 표기도 drift — T6 가 frontend.

각 worktree 의 `.env.local` 차이 — root `package.json` 의 dev script 가 `${PORT}` / `${WEB_PORT}` / `${WORKER_PORT}` 를 그대로 읽음 (05 § server/web/worker package.json):
```bash
# T1 Platform 예시 (4001/3001/8001)
PORT=4001                                                          # server (apps/server)
WEB_PORT=3001                                                      # web (apps/web 의 next dev --port)
WORKER_PORT=8001                                                   # converter-worker (uvicorn --port)
NEXT_PUBLIC_API_BASE=http://localhost:4001/api/v1
DATABASE_URL=postgres://...localhost:5432/{{PROJECT_SLUG}}_t1      # 팀별 DB 분리 (옵션)
```
> default (env 없을 때): 4000/3000/8000. integration 워크트리 가 default 사용. 팀별 worktree 는 위 env 로 override.

DB 분리 옵션:
- **공유 DB + 단일 migration** (기본) — 통합 브랜치에서만 migrate, 팀 worktree 는 동일 schema 읽음.
- **팀별 DB** (e2e 격리 필요 시) — `CREATE DATABASE {{PROJECT_SLUG}}_t1; ...` 각각 migrate.

### Shared / Interface 변경 lock

`packages/shared` 또는 `packages/interfaces` 를 수정하는 PR 은:
1. `docs/rfc/<date>-<topic>.md` 먼저 (위 충돌 절차).
2. 변경 PR 은 **integration owner** 가 직접 머지. 다른 팀 PR 은 그 PR 머지 후 rebase.
3. 변경 PR 머지 직후 Slack `{{ALERT_SLACK_CHANNEL}}` 에 자동 알림.

### Merge sequencing (Phase 별)

```
1. 각 팀 PR → integration/phase-<N> 머지 (squash, 1팀 1커밋)
2. integration owner: integration/phase-<N> 에서 통합 e2e smoke
3. 통과 시 integration/phase-<N> → main fast-forward
4. 각 팀 worktree pull 후 다음 phase branch 생성
```

### Conflict resolution 정책

| 충돌 영역 | 해결 |
|---|---|
| `packages/shared/src/types/*.ts` | RFC + integration owner 결정 |
| `apps/server/src/db/schema.ts` | 마이그레이션 번호 충돌 — 늦게 머지하는 팀이 번호 재할당 + `drizzle/meta/_journal.json` 재생성 |
| `pnpm-lock.yaml` | **MR target (`integration/phase-N`)** 의 lock 으로 reset 후 `pnpm install` 재실행. main 기준 아님 — 08 § Agent Task Packet 의 `base`/`mr_target` 와 일치. |
| `apps/web/src/app/layout.tsx` | T6 Frontend 가 소유 — 다른 팀은 issue 로 요청 |
| `.gitlab-ci.yml` | T1 Platform owner 외 직접 수정 금지 |

### Integration owner 역할

각 sprint 의 RC 한 명이:
- integration branch 의 머지 순서 결정
- e2e smoke 실패 분류 (어느 팀 책임인지 → 핫픽스 요청)
- main fast-forward push 의 유일한 권한자
- 다음 sprint 시작 시 다른 사람으로 rotation

### Merge queue (팀 수 ≥ 4)

GitLab MR `merge_when_pipeline_succeeds` + linear-history:
- main 은 항상 fast-forward only.
- 동시 머지 충돌 시 queue 가 자동 rebase.
- `red-test-allowed` 라벨 PR 은 queue 밖에서 별도 머지.

### 매일 sync (15분)

- 각 팀 1명씩 standup — 진행/blocker/오늘 의존.
- shared/interface 변경 예고 → 다른 팀 미리 rebase 준비.
- integration owner 가 다음 머지 순서 발표.

## 개발 속도 추정 (병렬 가정)

원본은 2명이 2.5개월에 v1 완성 (~ 695 commits). v2 는 6팀이 평행으로 진행하면 동일 결과물을 약 **4-6주** 에 달성 가능 (Phase 0 셋업 ~ Phase 9 polish).

병목:
- packages/shared 변경 시 모든 팀 sync wait
- DB 마이그레이션 (선형, T1+T2+T3 의존)
- Frontend 는 server API contract 가 안정화돼야 시작 — 그러나 mock client 로 일찍 시작 가능

자세한 일정은 [08-SPRINT-PLAN.md](08-SPRINT-PLAN.md).

# 05 · Repo Structure — 모노레포 구조

## 디렉토리 트리 (depth 2~3)

```
{{PROJECT_SLUG}}/
├── README.md                     # quickstart (3줄)
├── CLAUDE.md                     # Claude Code 가이드
├── AGENTS.md                     # 서브에이전트 가이드
├── CONTRIBUTING.md               # 기여 가이드
├── LICENSE
├── package.json                  # root scripts, pnpm.overrides
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── turbo.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── .gitlab-ci.yml
├── .husky/
│   ├── pre-commit                # identity, lint-staged, gitleaks
│   ├── commit-msg                # sprint key regex
│   └── pre-push                  # type check
├── .gitlab/
│   ├── CODEOWNERS                # 도메인별 owner 팀
│   ├── merge_request_templates/
│   │   ├── default.md            # 6섹션 PR template
│   │   ├── db-change.md          # 마이그레이션용
│   │   └── security.md
│   └── issue_templates/
│
├── apps/
│   ├── server/                   # Hono 백엔드
│   ├── web/                      # Next.js 프론트
│   └── converter-worker/         # PPTX/DOCX → PDF (Python)
│
├── packages/
│   ├── shared/                   # 공유 타입/상수/스키마
│   ├── interfaces/               # contract 인터페이스
│   ├── eslint-config/            # 공유 ESLint config
│   ├── typescript-config/        # 공유 tsconfig
│   └── test-utils/               # 테스트 helper
│
├── skills/                       # 사용자 스킬 (semver 디렉토리)
│   ├── {{BRAND_PPTX_SKILL_NAME}}/
│   ├── doc-coauthoring/
│   └── ...
│
├── infra/
│   ├── aws/
│   │   ├── terraform/            # IaC (옵션)
│   │   ├── task-definitions/
│   │   ├── setup-infra.sh
│   │   └── deploy.sh
│   └── docker/
│       ├── server.Dockerfile
│       ├── web.Dockerfile
│       └── converter-worker.Dockerfile
│
├── docs/
│   ├── plans/                    # 스프린트 폴더 (v1.0-S03-...)
│   ├── decisions/                # ADR 자동 생성
│   │   ├── INDEX.md
│   │   ├── ADR-0001-llm-primary.md
│   │   └── ...
│   ├── architecture/
│   ├── reference/
│   ├── ops/
│   ├── spikes/                   # 시간 박스 탐색 산출물
│   └── runbooks/                 # incident response
│
├── scripts/
│   ├── setup-git.sh              # clone 직후 git config 세팅
│   ├── tunnel.sh                 # SSM tunnel
│   ├── lint-skills.ts
│   ├── cross-domain-import-check.ts
│   ├── audit-deps.ts
│   └── generate-adr.ts           # GitLab API → docs/decisions/
│
└── .claude/                      # Claude Code 설정 (commit 됨)
    ├── settings.json
    ├── commands/
    ├── agents/
    └── skills/
```

## 패키지 경계 (의존성 그래프)

```
                ┌──────────────┐
                │   packages/  │
                │   shared     │
                │  interfaces  │
                └──────┬───────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
  ┌─────▼─────┐  ┌─────▼─────┐  ┌────▼──────┐
  │  apps/    │  │  apps/    │  │  apps/    │
  │  server   │  │   web     │  │ converter │
  │           │  │           │  │  -worker  │
  └─────┬─────┘  └─────┬─────┘  └───────────┘
        │              │
        └──────┬───────┘
               │
        ┌──────▼───────┐
        │   skills/    │  (SKILL.md 만 server 가 읽음)
        │   ...        │
        └──────────────┘
```

**금지 규칙**:
- `apps/web` 가 `apps/server` 또는 그 반대 직접 import 금지 (HTTP 또는 packages 만)
- `skills/*` 는 어떤 패키지도 못 import (server 가 SKILL.md 만 읽음)
- 한 도메인이 다른 도메인의 내부 모듈을 directly import 금지 (L14)

## 각 패키지 detail

### `apps/server`

```
apps/server/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── vitest.config.ts
└── src/
    ├── index.ts                  # 부트스트랩
    ├── app.ts                    # 라우트/미들웨어 등록
    ├── env.ts                    # env 파싱 (Zod)
    ├── middleware/
    │   ├── auth.ts
    │   ├── jwt.ts
    │   ├── rls-context.ts
    │   ├── rate-limit.ts
    │   ├── csp.ts
    │   └── request-context.ts
    ├── routes/
    │   ├── auth.ts
    │   ├── sessions.ts
    │   ├── messages.ts
    │   ├── projects.ts
    │   ├── artifacts.ts
    │   ├── artifact-shares.ts
    │   ├── skills.ts
    │   ├── uploads.ts
    │   ├── memories.ts
    │   ├── notifications.ts
    │   ├── mcp-servers.ts
    │   ├── config.ts
    │   ├── usage.ts
    │   ├── quota.ts
    │   ├── admin/
    │   │   ├── users.ts
    │   │   ├── settings.ts
    │   │   ├── operations.ts
    │   │   ├── health.ts
    │   │   └── tool-metrics.ts
    │   └── public-share.ts
    ├── orchestrator/
    │   ├── orchestrator.ts
    │   ├── prompt-builder.ts
    │   ├── memory-extractor.ts
    │   ├── memory-retriever.ts
    │   ├── context-compactor.ts
    │   ├── title-generator.ts
    │   ├── query-rewriter.ts
    │   └── citation-helper.ts
    ├── tools/
    │   ├── tool-router.ts
    │   ├── policy-engine.ts
    │   ├── hitl-manager.ts
    │   ├── choice-manager.ts
    │   ├── handlers/
    │   │   ├── bash.handler.ts
    │   │   ├── create-file.handler.ts
    │   │   ├── str-replace.handler.ts
    │   │   ├── view.handler.ts
    │   │   ├── present-files.handler.ts
    │   │   ├── web-fetch.handler.ts
    │   │   ├── web-search.handler.ts
    │   │   ├── knowledge-search.handler.ts
    │   │   ├── time.handler.ts
    │   │   ├── choice.handler.ts
    │   │   ├── conversation-search.handler.ts
    │   │   ├── recent-chats.handler.ts
    │   │   └── list-projects.handler.ts
    │   └── sandbox/
    │       ├── transport.ts      # interface
    │       ├── e2b-transport.ts
    │       ├── mock-transport.ts
    │       └── warm-pool.ts
    ├── knowledge/
    │   ├── parser-pipeline.ts
    │   ├── pdf-parser.ts
    │   ├── pptx-parser.ts
    │   ├── docx-parser.ts
    │   ├── xlsx-parser.ts
    │   ├── chunker.ts
    │   ├── embedding-provider.ts
    │   ├── search-service.ts
    │   └── markdown-builder.ts
    ├── mcp/
    │   ├── mcp-bridge.ts
    │   ├── mcp-client-pool.ts
    │   ├── mcp-tool-adapter.ts
    │   └── url-validator.ts      # SSRF 보호
    ├── db/
    │   ├── client.ts
    │   ├── schema.ts             # Drizzle 전체 스키마
    │   ├── migrations/
    │   │   ├── _journal.json
    │   │   └── 0001_*.sql ...
    │   ├── data-access.ts        # interface
    │   ├── drizzle-data-access.ts
    │   ├── *-service.ts          # 도메인 서비스
    │   ├── redis.ts
    │   └── migrate.ts
    ├── lib/
    │   ├── logger.ts             # typed object logger
    │   ├── rate-limiter.ts
    │   ├── alert-engine.ts
    │   ├── health-checker.ts
    │   ├── job-runner.ts         # AbortSignal 의무
    │   ├── data-retention.ts
    │   ├── office-pdf-converter.ts  # HTTP client only
    │   └── sanitize.ts
    └── __tests__/                # vitest
        ├── fixtures/
        ├── mocks/
        │   ├── data-access.mock.ts
        │   ├── sandbox.mock.ts
        │   └── llm.mock.ts
        ├── unit/
        ├── integration/
        └── e2e/
```

### `apps/web` — 상세 컴포넌트/Context/화면 명세

> **단일 출처**: [18-FRONTEND-WIREFRAMES.md](18-FRONTEND-WIREFRAMES.md) — 16개 화면 인벤토리, Context 3개, 컴포넌트 트리, 디자인 토큰, UX 패턴, 키보드/a11y 가이드.



```
apps/web/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── src/
    ├── app/                      # Next.js App Router
    │   ├── layout.tsx
    │   ├── globals.css
    │   ├── (auth)/
    │   │   ├── login/
    │   │   └── signup/
    │   ├── (chat)/
    │   │   ├── page.tsx          # 홈
    │   │   └── [sessionId]/
    │   ├── projects/
    │   │   └── [projectId]/
    │   ├── settings/
    │   ├── share/
    │   │   └── [token]/          # 익명 공유
    │   └── admin/
    ├── components/
    │   ├── chat/
    │   ├── artifacts/
    │   ├── project/
    │   ├── settings/
    │   ├── memory/
    │   ├── mcp/
    │   ├── skills/
    │   ├── layout/
    │   ├── ui/                   # base primitives
    │   ├── blocks/
    │   └── icons/
    ├── context/
    │   ├── AppContext.tsx
    │   ├── ArtifactContext.tsx
    │   └── FeedbackContext.tsx
    ├── hooks/
    │   ├── useAuth.ts
    │   ├── useSession.ts
    │   ├── useSessionStream.ts   # SSE
    │   ├── useProjects.ts
    │   ├── useArtifacts.ts
    │   ├── useMemories.ts
    │   ├── useSkills.ts
    │   ├── useMcpServers.ts
    │   └── useNotifications.ts
    ├── lib/
    │   ├── api-client.ts         # typed (zod-openapi gen)
    │   ├── auth.ts
    │   ├── markdown.ts
    │   ├── citation-plugin.ts
    │   └── formats.ts
    └── __tests__/
```

### `apps/converter-worker`

```
apps/converter-worker/
├── pyproject.toml
├── Dockerfile
└── src/
    ├── main.py                   # FastAPI (단일 결정)
    ├── pptx_to_pdf.py            # LibreOffice 호출
    ├── docx_to_pdf.py
    ├── api.py                    # FastAPI router (16-API-CONTRACT.md § converter API)
    └── tests/
```

### converter-worker API (server↔worker contract)

| Path | Method | Body | Response |
|---|---|---|---|
| `/convert/pptx-to-pdf` | POST | `{ s3KeyIn: string, s3KeyOut: string }` | `{ pages: number, durationMs: number }` |
| `/convert/docx-to-pdf` | POST | `{ s3KeyIn: string, s3KeyOut: string }` | `{ pages, durationMs }` |
| `/health` | GET | - | `{ status: "ok" }` |

server 의 `apps/server/src/lib/office-pdf-converter.ts` 가 이 endpoint 호출. CONVERTER_WORKER_URL env 변수 (예: `http://{{PROJECT_SLUG}}-converter-worker.{{PROJECT_SLUG}}-prod.local:8000`).

### `packages/shared`

```
packages/shared/src/
├── index.ts
├── types/
│   ├── auth.ts
│   ├── session.ts
│   ├── project.ts
│   ├── artifact.ts
│   ├── memory.ts
│   ├── skill.ts
│   ├── mcp.ts
│   ├── quota.ts
│   ├── log.ts                    # LogLevel, LogCategory
│   └── permission.ts             # PermissionTier
├── schemas/
│   ├── auth.schema.ts            # Zod
│   ├── message.schema.ts
│   ├── artifact.schema.ts
│   └── ...
├── constants.ts
└── cost-utils.ts
```

### `packages/interfaces`

```
packages/interfaces/src/
├── index.ts                      # barrel
├── types.ts                      # § 0 foundational + shared (Repo<T,F>, JsonSchema, AgentToolSpec/Result/Base, ChatEvent, 모든 Record 타입)
├── errors.ts                     # {{PROJECT_NAME_PASCAL}}Error + ErrorCategory enum
├── AgentTool.ts                  # 핵심 1 — ToolContext (facade) + AgentToolInvocation + final AgentTool
├── SandboxTransport.ts           # 핵심 2
├── DataAccess.ts                 # 핵심 3
├── ArtifactStore.ts              # 핵심 4
├── EmbeddingProvider.ts          # 핵심 5
├── LLMProvider.ts                # 핵심 6
├── SkillRegistry.ts              # 핵심 7
├── McpClientPool.ts              # 핵심 8
├── HitlBridge.ts                 # 보조 9 (ToolContext.hitl)
├── BudgetClaim.ts                # 보조 10 (ToolContext.budget)
├── Logger.ts                     # 보조 11 (ToolContext.logger)
└── EmailSender.ts                # 보조 12 (auth flow 의존, Phase 1+ 사용)
```

총 15 파일 (12 contract + index/types/errors). 시그니처 본문은 **[14-INTERFACES.md](14-INTERFACES.md) 단일 출처**.

### `skills/<name>/`

```
skills/<name>/
├── SKILL.md                      # frontmatter (name, version, description)
├── CHANGELOG.md
├── package.json                  # 버전 명시
├── scripts/                      # python/node 실행 스크립트
└── assets/                       # 폰트/이미지 등
```

## CODEOWNERS 예시

```
# /.gitlab/CODEOWNERS

# 07-AGENT-TEAMS 의 T1~T6 팀과 1:1 매핑:
#   @team-platform     = T1 Platform   (infra/CI/CD/sandbox/MCP/db migrations/auth)
#   @team-orchestrator = T2 Orchestrator
#   @team-knowledge    = T3 Knowledge  (knowledge/RAG)
#   @team-artifact     = T4 Artifact   (artifact routes/server side)
#   @team-skills       = T5 Skills
#   @team-frontend     = T6 Frontend   (모든 apps/web/, 단 artifact 컴포넌트는 T4 와 공동)
/apps/server/src/orchestrator/   @team-orchestrator
/apps/server/src/knowledge/      @team-knowledge
/apps/server/src/tools/sandbox/  @team-platform
/apps/server/src/tools/handlers/ @team-orchestrator                # built-in tool handlers (web_search, knowledge_search 등)
/apps/server/src/tools/skills-engine.ts  @team-skills
/apps/server/src/mcp/            @team-platform
/apps/server/src/db/migrations/  @team-platform                    # 마이그레이션 단일 owner
/apps/server/src/db/schema.ts    @team-platform                    # schema 단일 owner
/apps/server/src/middleware/     @team-platform                    # auth/jwt/rls-context/rate-limit/request-context
/apps/server/src/mappers/        @team-platform @team-leads         # Record → DTO 변환 (Phase 0.5 owned, 14 § mapper naming convention)
/apps/server/src/lib/email-sender.ts        @team-platform
# 다음 2 파일은 Phase 0.5 산출물 (Tier B). 후속 변경도 Phase 0.5 owner (integration RC) + Tier B 승인:
/apps/server/src/lib/errors.ts              @team-platform @team-leads
/apps/server/src/middleware/envelope.ts     @team-platform @team-leads
/apps/server/src/routes/auth.ts  @team-platform
/apps/server/src/routes/sessions.ts         @team-orchestrator     # 08 § T2 owned_paths 와 1:1
/apps/server/src/routes/messages.ts         @team-orchestrator     # 08 § T2 owned_paths 와 1:1
/apps/server/src/routes/projects.ts         @team-platform         # T1 owned — RLS (projects_*) + bootstrap_project_owner SECURITY DEFINER 가 T1 책임. 08 § Phase 3 T1 owned_paths 와 일관.
/apps/server/src/routes/uploads.ts          @team-knowledge        # 08 § T3 owned_paths 와 1:1
/apps/server/src/routes/documents.ts        @team-knowledge        # 08 § T3 owned_paths 와 1:1
/apps/server/src/routes/artifact*.ts        @team-artifact
/apps/server/src/routes/public-share.ts     @team-artifact
/apps/server/src/routes/mcp-servers.ts      @team-platform     # 16 § /mcp-servers 와 일관 (라운드 36 unification)
/apps/server/src/routes/memories.ts         @team-orchestrator     # memory extract 는 orchestrator 가 호출
/apps/server/src/routes/admin*.ts           @team-leads @team-platform
/apps/server/src/openapi.ts                 @team-platform @team-leads  # Phase 0.5 owned
/apps/server/scripts/generate-openapi.ts    @team-platform @team-leads  # Phase 0.5 owned
/apps/web/src/                   @team-frontend                    # 기본 owner
/apps/web/src/components/artifacts/  @team-artifact @team-frontend # T4 (server contract) + T6 (UI shell) 공동
/apps/web/src/lib/api-client.ts             @team-platform @team-leads  # Phase 0.5 owned
/apps/web/src/lib/api-types.generated.ts    @team-platform @team-leads  # auto-generated, Phase 0.5 owned
/apps/converter-worker/          @team-platform
/skills/                         @team-skills
/infra/                          @team-platform
/docs/decisions/                 @team-leads
/scripts/                        @team-platform                    # CI 보조 scripts, lint-plan 등
# packages/shared, packages/interfaces 변경은 모든 팀 + leads 승인.
# GitLab CODEOWNERS approval 은 section 단위로 계산됨 (https://docs.gitlab.com/user/project/codeowners/advanced/).
# 한 줄에 7 owner 나열은 "1 명 승인" 만 강제 → 의도된 7-owner 미강제.
# 해결: 각 owner 를 별도 [Section] 으로 분리. GitLab 이 section 마다 독립 1 approval 의무.

[Shared-Leads][1]
/packages/shared/                @team-leads
/packages/interfaces/            @team-leads

[Shared-Platform][1]
/packages/shared/                @team-platform
/packages/interfaces/            @team-platform

[Shared-Orchestrator][1]
/packages/shared/                @team-orchestrator
/packages/interfaces/            @team-orchestrator

[Shared-Knowledge][1]
/packages/shared/                @team-knowledge
/packages/interfaces/            @team-knowledge

[Shared-Artifact][1]
/packages/shared/                @team-artifact
/packages/interfaces/            @team-artifact

[Shared-Skills][1]
/packages/shared/                @team-skills
/packages/interfaces/            @team-skills

[Shared-Frontend][1]
/packages/shared/                @team-frontend
/packages/interfaces/            @team-frontend

# Branch Rule: `main` 과 `integration/phase-*` 에 "Code Owner approval required" 를 활성화.
# Approval Rules: 위 7 section 각각이 독립 1 명 승인 의무 → 합산 7-owner 강제.

# DB 마이그레이션은 T1 Platform 단독 commit owner.
[DB-Platform]
/apps/server/src/db/migrations/  @team-platform
/apps/server/src/db/schema.ts    @team-platform
```

## scripts/ (자동화 스크립트)

| 스크립트 | 역할 |
|---|---|
| `setup-git.sh` | 처음 clone 후 git config 자동 설정 (L08) |
| `tunnel.sh` | AWS SSM 터널 (RDS + Redis) |
| `lint-skills.ts` | 스킬 frontmatter / semver 검증 (L09) |
| `cross-domain-import-check.ts` | 도메인 간 직접 import 검출 (L14) |
| `audit-deps.ts` | 의존성 중복 버전 검출 (L04) |
| `generate-adr.ts` | GitLab MR description → ADR md 자동 생성 (L18) |
| `seed.ts` | 개발 DB 시드 |
| `migration-dry-run.ts` | PR CI 에서 마이그레이션 미리 검증 |

자세한 사용은 [10-DEV-WORKFLOW.md](10-DEV-WORKFLOW.md) 참조.

---

## 부록 A · root 설정 파일 본문

### `package.json` (root)

```json
{
  "name": "{{PROJECT_SLUG}}",
  "version": "0.0.0",
  "private": true,
  "packageManager": "pnpm@10.29.3",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "turbo run dev --parallel",
    "dev:full": "concurrently -k -n nodes,worker -c blue,magenta \"pnpm dev:nodes\" \"pnpm dev:worker\"",
    "dev:nodes": "turbo run dev --parallel",
    "dev:worker": "cd apps/converter-worker && poetry run uvicorn src.main:app --reload --port ${WORKER_PORT:-8000}",
    "dev:no-worker": "turbo run dev --parallel",
    "build": "turbo run build",
    "test": "turbo run test",
    "test:watch": "turbo run test:watch --parallel",
    "test:unit": "turbo run test:unit",
    "test:integration": "turbo run test:integration",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "tunnel": "bash scripts/tunnel.sh",
    "db:migrate": "pnpm --filter @{{PROJECT_SLUG}}/server db:migrate",
    "db:seed": "pnpm --filter @{{PROJECT_SLUG}}/server db:seed",
    "audit:deps": "node scripts/audit-deps.mjs",
    "check:cross-domain": "node scripts/check-cross-domain-imports.mjs",
    "lint:skills": "node scripts/lint-skills.mjs",
    "load:100": "node scripts/load-test.mjs --users 100",
    "load:1000": "node scripts/load-test.mjs --users 1000",
    "smoke:staging": "bash scripts/smoke-test.sh staging",
    "e2e:run": "playwright test --reporter=line,junit",
    "gen:api-docs": "pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate",
    "prepare": "husky"
  },
  "devDependencies": {
    "turbo": "^2.5.0",
    "typescript": "5.6.0",
    "vitest": "2.1.0",
    "eslint": "^9.10.0",
    "@eslint/js": "^9.10.0",
    "typescript-eslint": "^8.0.0",
    "globals": "^15.0.0",
    "prettier": "^3.3.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0",
    "concurrently": "^9.0.0",
    "@types/node": "^22.5.0",
    "@anthropic-ai/sdk": "0.36.3",
    "@playwright/test": "^1.48.0",
    "playwright": "^1.48.0",
    "wait-on": "^8.0.0"
  },
  "pnpm": {
    "overrides": {
      "react": "19.0.0",
      "react-dom": "19.0.0",
      "typescript": "5.6.0",
      "vitest": "2.1.0",
      "pdfjs-dist": "4.5.136",
      "drizzle-orm": "0.36.0",
      "hono": "4.6.0",
      "@anthropic-ai/sdk": "0.36.3"
    }
  },
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix"],
    "*.{json,md,yml}": ["prettier --write"]
  }
}
```

### `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/server"
  - "apps/web"
  - "packages/*"
  # apps/converter-worker 는 Python (poetry) — pnpm workspace 밖.
  # `cd apps/converter-worker && poetry install` 로 별도 셋업.
```

### `turbo.json`

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "dist/**", "build/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true,
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": true,
      "outputs": ["coverage/**", "junit.xml"]
    },
    "test:unit": { "dependsOn": ["^build"], "cache": true },
    "test:integration": { "dependsOn": ["^build"], "cache": false },
    "test:watch": { "cache": false, "persistent": true, "dependsOn": ["^build"] },
    "lint": { "cache": true },
    "typecheck": { "dependsOn": ["^build"], "cache": true }
  }
}
```

### `tsconfig.json` (root — `pnpm typecheck` 의 진입점)

```json
{
  "extends": "./tsconfig.base.json",
  "include": ["packages/*/src", "apps/server/src", "apps/web/src"],
  "exclude": ["**/dist", "**/.next", "**/node_modules", "**/coverage"],
  "references": [
    { "path": "./packages/shared" },
    { "path": "./packages/interfaces" }
  ]
}
```

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "esModuleInterop": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"]
    // "types" 는 base 에서 지정 안 함 — 각 패키지가 override.
    //   apps/server/tsconfig.json: "types": ["node"]
    //   apps/web/tsconfig.json   : (지정 안 함, Next.js 가 자동) 또는 "types": ["node", "react"]
    //   packages/*/tsconfig.json : 필요 시만
  }
}
```

### 사용 방법

새 개발자 Phase 0 quickstart:

```bash
git clone <repo> && cd {{PROJECT_SLUG}}
bash scripts/setup-git.sh                  # author email 확인

# Node 의존성 (~2분, 캐시 hit 시 30s)
pnpm install

# Python 의존성 (converter-worker — pnpm workspace 밖이라 별도)
( cd apps/converter-worker && poetry install )

# secrets — 시나리오 별 차이 (단일 출처: 11 § 부록 B)
#   A) SSM tunnel: `.env.example` (시나리오 A default) 를 채워서 .env.local 작성
#   B) docker-compose: `.env.local.example` 복사 (Phase 0 dev fast-path — 무수정 즉시 동작)
cp .env.local.example .env.local      # ← Phase 0 default (시나리오 B). secret stub 포함, 수정 불필요.
# cp .env.example .env.local           # ← 시나리오 A (SSM tunnel) — real secret 채워야 함.

# 인프라 연결 — 다음 둘 중 하나 선택 (.env.local 시나리오와 일치):
#   A) AWS dev 환경 사용: SSM 터널 (11-DEPLOYMENT § 부록 E setup-infra.sh 가 만든 RDS/Redis/bastion 필요)
# pnpm tunnel
#   B) 완전 로컬: docker compose 로 pgvector + redis 띄우기 (compose 본문은 11 § 부록 G) — Phase 0 default
docker compose -f docker-compose.local.yml up -d --wait      # --wait: healthcheck PASS 까지 block (race 차단)

pnpm db:migrate                            # 최신 마이그레이션 (Phase 0 = empty journal, 0 exit)
# pnpm db:seed                             # Phase 0 는 seed.ts 가 no-op (organizations/users 테이블 미존재). Phase 1+ 부터 실 seed.
pnpm dev                                   # web:3000 + server:4000 (Node 만 — T1 의 default)
# 또는 worker 도 함께 (Python poetry install 후):
# pnpm dev:full                              # web + server + converter-worker:8000
```

> **검증** (Phase 0 acceptance — **로그인 화면 미포함**, Phase 1+ 의무):
> 1. `pnpm install` 성공
> 2. `pnpm typecheck && pnpm lint && pnpm test` 모두 0 exit
> 3. `pnpm dev` 가 web/server 양쪽 listen → 다음 3 endpoint 응답:
>    - `curl http://localhost:4000/health` → `{"status":"ok",...}`
>    - `curl http://localhost:4000/api/v1/_ping` → `{"data":{"ok":true},...}`
>    - `curl -I http://localhost:3000/` → `200 OK` (placeholder 홈 페이지, "{{PROJECT_NAME}}" 표시. 로그인은 Phase 1)
>
> Phase 1 + Phase 2 통합 후의 magic-link signup + 채팅 acceptance 는 별도 ([08 § Phase 1+2 통합 acceptance](08-SPRINT-PLAN.md)).
> **선결조건**: A 경로면 `setup-infra.sh` 실행 후 bastion + SSM 파라미터 존재. B 경로면 Docker Desktop 설치.

## 부록 B · 앱별 / 패키지별 `package.json` 본문

### `apps/server/package.json`

```json
{
  "name": "@{{PROJECT_SLUG}}/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file=../../.env.local --env-file=.env.local src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node --env-file-if-exists=.env.local dist/index.js",
    "test": "vitest run --coverage --coverage.reporter=cobertura --coverage.reporter=text",
    "test:unit": "vitest run --dir src --exclude src/__tests__/integration --coverage --coverage.reporter=cobertura",
    "test:integration": "vitest run --dir src/__tests__/integration --passWithNoTests",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src",
    "db:migrate": "tsx --env-file-if-exists=../../.env.local --env-file-if-exists=.env.local node_modules/drizzle-kit/bin.cjs migrate",
    "db:migrate:status": "tsx --env-file-if-exists=../../.env.local --env-file-if-exists=.env.local scripts/db-migrate-status.ts",
    "db:migrate:expand": "tsx --env-file-if-exists=../../.env.local --env-file-if-exists=.env.local scripts/db-migrate-expand.ts",
    "db:generate": "drizzle-kit generate",
    "db:seed": "tsx --env-file-if-exists=../../.env.local --env-file-if-exists=.env.local src/db/seed.ts",
    "openapi:generate": "tsx scripts/generate-openapi.ts"
  },
  "dependencies": {
    "@{{PROJECT_SLUG}}/shared": "workspace:*",
    "@{{PROJECT_SLUG}}/interfaces": "workspace:*",
    "hono": "4.6.0",
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "@hono/zod-openapi": "^0.18.0",
    "openapi-typescript": "^7.4.0",
    "zod": "^3.23.0",
    "drizzle-orm": "0.36.0",
    "pg": "^8.13.0",
    "ioredis": "^5.4.0",
    "bullmq": "^5.0.0",
    "@anthropic-ai/sdk": "0.36.3",
    "openai": "^4.0.0",
    "@google/generative-ai": "^0.21.0",
    "voyageai": "^0.0.4",
    "@e2b/code-interpreter": "^1.0.0",
    "@aws-sdk/client-s3": "^3.600.0",
    "@aws-sdk/client-secrets-manager": "^3.600.0",
    "@aws-sdk/s3-request-presigner": "^3.600.0",
    "jsonwebtoken": "^9.0.0",
    "bcryptjs": "^2.4.3",
    "pino": "^9.0.0",
    "pino-pretty": "^11.0.0",
    "node-cron": "^3.0.0",
    "uuid": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/uuid": "^10.0.0",
    "@types/pg": "^8.11.0",
    "tsx": "^4.0.0",
    "vitest": "2.1.0",
    "@vitest/coverage-v8": "2.1.0",
    "drizzle-kit": "0.27.0"
  }
}
```

### `apps/web/package.json`

```json
{
  "name": "@{{PROJECT_SLUG}}/web",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev --port ${WEB_PORT:-3000}",
    "build": "next build",
    "start": "next start --port ${WEB_PORT:-3000}",
    "test": "vitest run --coverage --coverage.reporter=cobertura --coverage.reporter=text",
    "test:unit": "vitest run --dir src --coverage --coverage.reporter=cobertura",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src next.config.ts tailwind.config.ts",
    "api-types:generate": "openapi-typescript ../server/openapi.json -o src/lib/api-types.generated.ts"
  },
  "dependencies": {
    "@{{PROJECT_SLUG}}/shared": "workspace:*",
    "next": "15.0.0",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "rehype-highlight": "^7.0.0",
    "react-pdf": "^9.0.0",
    "pdfjs-dist": "4.5.136",
    "lucide-react": "^0.450.0",
    "swr": "^2.2.0",
    "zod": "^3.23.0",
    "clsx": "^2.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@types/react": "19.0.0",
    "@types/react-dom": "19.0.0",
    "@tailwindcss/postcss": "4.0.0",
    "tailwindcss": "4.0.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0",
    "vitest": "2.1.0",
    "@vitest/coverage-v8": "2.1.0",
    "@testing-library/react": "^16.0.0",
    "@testing-library/jest-dom": "^6.5.0",
    "jsdom": "^25.0.0",
    "openapi-typescript": "^7.0.0",
    "eslint-config-next": "15.0.0"
  }
}
```

### `apps/web/tsconfig.json` (Phase 0 — typecheck 통과 의무)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "jsx": "preserve",
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next-env.d.ts",
    ".next/types/**/*.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "next.config.ts",
    "tailwind.config.ts"
  ],
  "exclude": ["node_modules", ".next", "dist"]
}
```

### `apps/web/next-env.d.ts` (Phase 0 — Next.js types 보장. `next build` / `next dev` 가 자동 갱신하지만 Phase 0 부터 commit 해야 typecheck 통과)

```typescript
/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: 본 파일은 Next.js 가 자동 관리 — 수동 수정 금지.
// see https://nextjs.org/docs/app/api-reference/config/typescript
```

### `apps/web/next.config.ts`

```typescript
import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",                 // Docker multi-stage 최적화
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // SSE proxy — /api/v1 은 server 로 전달
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.NEXT_PUBLIC_API_BASE?.replace("/api/v1", "") ?? "http://localhost:4000"}/api/:path*`,
    }];
  },
  headers: async () => [{
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ],
  }],
};

export default config;
```

### `apps/converter-worker/pyproject.toml`

```toml
[tool.poetry]
name = "{{PROJECT_SLUG}}-converter-worker"
version = "0.0.0"
description = "{{PROJECT_NAME}} converter worker — PPTX/DOCX → PDF (LibreOffice)"
authors = []

[tool.poetry.dependencies]
python = "^3.12"
fastapi = "^0.115.0"
uvicorn = {extras = ["standard"], version = "^0.32.0"}
boto3 = "^1.35.0"
python-multipart = "^0.0.12"

[tool.poetry.group.dev.dependencies]
pytest = "^8.3.0"
httpx = "^0.27.0"

[build-system]
requires = ["poetry-core"]
build-backend = "poetry.core.masonry.api"
```

### `packages/shared/package.json`

```json
{
  "name": "@{{PROJECT_SLUG}}/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json -w",
    "test": "vitest run --coverage --coverage.reporter=cobertura --coverage.reporter=text",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src"
  },
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "vitest": "2.1.0",
    "@vitest/coverage-v8": "2.1.0"
  }
}
```

> `@vitest/coverage-v8` 는 `test` 스크립트의 `--coverage.reporter=cobertura` 가 호출하는 reporter 가 의존. server/web/shared 모두 동일 패턴.

### `packages/interfaces/package.json`

```json
{
  "name": "@{{PROJECT_SLUG}}/interfaces",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json -w",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src"
  },
  "dependencies": {
    "@{{PROJECT_SLUG}}/shared": "workspace:*"
  },
  "devDependencies": {
    "vitest": "2.1.0"
  }
}
```

> `interfaces` 는 순수 타입 패키지라 실제 테스트가 없을 수 있음 — `--passWithNoTests` 로 CI 의 `pnpm --filter "./packages/*" test` 호출이 빈 결과로도 0 exit 보장.

### 공유 `tsconfig.json` (각 app/package 의)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

### 공유 ESLint config (`eslint.config.mjs`, root)

> **Next 15 + ESLint v9 flat config 정책 (반복 질문 차단)**:
> Next 15 의 `next lint` 는 `.eslintrc.json` (legacy) 을 default. Next 16 에서 제거 예정 ([Next 16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16)). 본 plan 은 **future-proof** flat config 채택:
> - root flat config (`eslint.config.mjs`) 가 단일 출처. Next.js 의 `eslint-config-next` 규칙은 본 config 안에 `compat.config()` 또는 명시 rules 로 통합.
> - web 의 `pnpm lint` = `eslint src next.config.ts tailwind.config.ts` (next lint 사용 안 함).
> - lint § 109 가 web package.json 의 lint script 가 `next lint` 가 아닌지 검증.

```javascript
import js from "@eslint/js";
import ts from "typescript-eslint";
import globals from "globals";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  // Node 환경: server, scripts, converter-worker (TS), drizzle config
  {
    files: ["apps/server/**/*.ts", "scripts/**/*.{ts,mjs}", "**/*.config.{ts,mjs}", "apps/server/scripts/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, crypto: "readonly" },   // Node 20+ 의 globalThis.crypto
    },
  },
  // Browser 환경: web (Next.js) — eslint-config-next 의 핵심 규칙을 명시.
  // Next 15 의 권장: a11y + react hooks. server component / RSC 룰은 Next 가 모듈로 export 안 함 → 본 flat config 가 plugin import 로 직접 통합 (Phase 0.5 가 마무리).
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },   // Next.js 는 server component 도 있어 둘 다
    },
    // Phase 0.5 에서 추가: import "eslint-plugin-react-hooks" + "eslint-plugin-jsx-a11y" 의 recommended.
    // (Phase 0 는 base flat config 만 — `pnpm lint` 가 0 exit 통과 보장이 목적)
  },
  // Vitest 환경: 테스트 파일
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.vitest },
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["error", { allow: ["warn", "error"] }],  // logger 강제
    },
    ignores: ["**/dist/**", "**/.next/**", "**/coverage/**", "**/*.generated.ts"],
  },
];
```

`globals` 패키지를 root devDeps 에 추가 — 위 `eslint.config.mjs` 가 의존.

## 부록 C · Phase 0 실행 가능한 entrypoint 본문

> 본 부록의 파일들을 그대로 복사하면 `pnpm install && pnpm typecheck && pnpm test && pnpm dev` 가 통과. T1 Skeleton 의 minimum bar.

### `apps/server/src/index.ts`
```typescript
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadEnv } from "./env.js";

const env = loadEnv();
const app = createApp(env);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.warn(`[server] listening on http://localhost:${info.port}`);
});
```

### `apps/server/src/app.ts`
```typescript
import { Hono } from "hono";
import type { Env } from "./env.js";

export function createApp(env: Env) {
  const app = new Hono();

  app.get("/health", (c) => c.json({
    status: "ok",
    deps: { db: "unknown", redis: "unknown", e2b: "unknown", llm: "unknown" },
    ts: new Date().toISOString(),
  }));

  // Phase 1 부터 routes 추가 (auth, sessions, ...)
  app.get("/api/v1/_ping", (c) => c.json({
    data: { ok: true, env: env.NODE_ENV },
    meta: { requestId: crypto.randomUUID() },
  }));

  return app;
}
```

### `apps/server/src/env.ts`
```typescript
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ALLOWED_DOMAINS: z.string(),
  EMAIL_SENDER_KIND: z.enum(["console", "ses", "smtp", "test", "noop"]).default("console"),
  // 16-API-CONTRACT § EmailSender 와 단일 출처: console (dev) / ses (prod) / smtp / test (unit) / noop (smoke).
  EMAIL_FROM: z.string().email().optional(),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error("ENV validation failed:", parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
```

### `apps/server/drizzle.config.ts`
```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  verbose: true,
  strict: true,
});
```

### `apps/server/src/db/client.ts`
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

export const db = drizzle(pool);
export const pgPool = pool;
```

### `apps/server/src/db/schema.ts` (Phase 0 시점 — 빈 export, Phase 1 부터 채움)
```typescript
// drizzle-kit 이 본 파일을 읽어 migration 을 생성. Phase 0 시점엔 빈 모듈.
// Phase 1 부터 organizations, users, ... 정의 추가.
export {};
```

### Phase 0 의 빈 migration bootstrap

drizzle-kit 은 `_journal.json` 이 없으면 첫 migration generate 시 에러. Phase 0 의 `pnpm db:migrate` 가 빈 schema 에서도 통과하려면 다음 파일을 미리 만들어야 함:

`apps/server/src/db/migrations/meta/_journal.json`:
```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": []
}
```

이 빈 journal 이 있으면:
- `drizzle-kit migrate` → "No pending migrations" 로 통과 (0 exit)
- Phase 1 의 `drizzle-kit generate` 가 `0001_*.sql` 추가 시 entries 에 자동 append

> **acceptance check**: Phase 0 에서 `pnpm --filter @{{PROJECT_SLUG}}/server db:migrate` 가 빈 schema 로 0 exit 통과해야 함. journal 누락 시 fail — Phase 0 산출물 매트릭스 (build_prompt § Phase 0) 가 본 파일을 의무 산출물로 표기.

### `apps/server/scripts/generate-openapi.ts`
```typescript
// generate-openapi.ts 는 contract 추출만 한다 — DB/Redis/JWT 같은 runtime env 의존 금지.
// loadEnv() 호출 안 함. title/baseUrl 만 별도 가벼운 env 로 받음.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOpenApi } from "../src/openapi.js";

const opts = {
  title: process.env.APP_NAME ?? "{{PROJECT_NAME}} API",
  baseUrl: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1",
  version: process.env.npm_package_version ?? "0.0.0",
};
const spec = buildOpenApi(opts);
const outPath = resolve(import.meta.dirname, "..", "openapi.json");
writeFileSync(outPath, JSON.stringify(spec, null, 2));
console.warn(`[gen-openapi] wrote ${outPath}`);
```

### `apps/server/src/openapi.ts` (Phase 0 — 최소 stub, Phase 1+ 에서 zod-openapi 로 확장)
```typescript
// buildOpenApi 는 순수 함수 — Env 가 아니라 metadata 만 받음.
// runtime 의 GET /openapi.json endpoint 도 같은 함수 호출 (env 불요).
export interface OpenApiOpts {
  title: string;
  baseUrl: string;
  version?: string;
}

export function buildOpenApi(opts: OpenApiOpts) {
  return {
    openapi: "3.1.0",
    info: { title: opts.title, version: opts.version ?? "0.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "ok" } } }
      }
    },
  };
}
```

### `apps/web/src/app/layout.tsx`
```tsx
import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "{{PROJECT_NAME}}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
```

### `apps/web/src/app/page.tsx`
```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">{{PROJECT_NAME}}</h1>
      <p className="mt-2 text-gray-600">Phase 0 — login 화면은 Phase 1 부터.</p>
    </main>
  );
}
```

### `apps/web/src/app/globals.css`
```css
@import "tailwindcss";
@theme { --color-bg: #ffffff; --color-fg: #111111; }
body { background: var(--color-bg); color: var(--color-fg); }
```

### `apps/converter-worker/src/main.py`
```python
from fastapi import FastAPI

app = FastAPI(title="{{PROJECT_NAME}} converter-worker")

@app.get("/health")
def health():
    return {"status": "ok", "service": "converter-worker"}

@app.post("/convert/pptx-to-pdf")
async def convert_stub():
    # Phase 4 에서 LibreOffice subprocess 본문 추가
    return {"data": {"ok": True, "note": "stub"}, "meta": {}}
```

### `apps/server/scripts/db-migrate-status.ts` (Phase 0 산출물 — package.json `db:migrate:status` 가 호출)

```typescript
// 현재 schema 와 migration journal 의 차이 출력 (CI 의 migrate-status job 이 호출).
// drizzle-kit 의 status 명령이 직접 없으므로 journal 과 DB 비교를 통해 pending 확인.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "pg";

const journalPath = resolve(import.meta.dirname, "..", "src/db/migrations/meta/_journal.json");
if (!existsSync(journalPath)) {
  console.error("[migrate-status] _journal.json 없음");
  process.exit(1);
}
const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as { entries: Array<{ idx: number; tag: string; when: number }> };

const url = process.env.DATABASE_URL;
if (!url) { console.error("[migrate-status] DATABASE_URL 미설정"); process.exit(1); }

const pg = new Client({ connectionString: url });
await pg.connect();

const tableExists = await pg.query(`SELECT to_regclass('public.__drizzle_migrations') AS t`);
if (!tableExists.rows[0].t) {
  console.log(`[migrate-status] __drizzle_migrations 없음 — ${journal.entries.length} pending`);
  await pg.end();
  process.exit(0);
}

const applied = await pg.query<{ hash: string; created_at: string }>(`SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at`);
const pending = journal.entries.length - applied.rows.length;
console.log(`[migrate-status] applied=${applied.rows.length} journal=${journal.entries.length} pending=${pending}`);
if (pending > 0) {
  for (let i = applied.rows.length; i < journal.entries.length; i++) {
    console.log(`  pending: ${journal.entries[i].tag}`);
  }
}
await pg.end();
process.exit(0);
```

### `apps/server/scripts/db-migrate-expand.ts` (Phase 0 산출물 — package.json `db:migrate:expand` 가 호출, deploy.sh 의 expand 단계가 의존)

```typescript
// expand-only 마이그레이션 (additive, backward compatible) 실행.
// v1.0 단순 정책: 모든 migration 이 expand-safe 라고 가정 (CREATE TABLE / ADD COLUMN NULLABLE / CREATE INDEX CONCURRENTLY).
// contract migration (DROP / RENAME / NOT NULL on existing) 은 다음 릴리스의 expand step 으로 분리 — 본 wrapper 가 거부.
// 본 wrapper 는 drizzle-kit migrate 를 그대로 호출하지만, 별도 user (migrator_user) 의 connection string 우선.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { resolve } from "node:path";

const url = process.env.DATABASE_URL_MIGRATOR ?? process.env.DATABASE_URL;
if (!url) { console.error("[migrate-expand] DATABASE_URL(_MIGRATOR) 미설정"); process.exit(1); }

const pg = new Client({ connectionString: url });
await pg.connect();
const db = drizzle(pg);

const migrationsFolder = resolve(import.meta.dirname, "..", "src/db/migrations");
console.log(`[migrate-expand] running from ${migrationsFolder}`);

try {
  await migrate(db, { migrationsFolder });
  console.log("[migrate-expand] ✓ done");
  await pg.end();
  process.exit(0);
} catch (e) {
  console.error("[migrate-expand] ❌", e);
  await pg.end();
  process.exit(1);
}
```


### `apps/server/package.json` 의 추가 script (Phase 0 시점부터 CI 가 요구)
```json
"scripts": {
  "lint:skills": "node ../../scripts/lint-skills.mjs"
}
```

> **`db:migrate:status` 단일 정의**: § 부록 C 의 server package.json 본문 (line 713) 이 단일 출처 — `tsx scripts/db-migrate-status.ts` 호출. 본 표는 추가 script (`lint:skills`) 만 명시. drizzle-kit `--dry-run` legacy snippet 은 제거됨 (라운드 35).

위 본문을 그대로 복사하면 `pnpm install && pnpm typecheck && pnpm lint && pnpm test && pnpm dev` 모두 통과. Phase 1 에서 routes/db/schema 본문이 점진적으로 채워짐.

### `apps/web/tailwind.config.ts`
```typescript
import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/hooks/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--color-bg)",
        fg: "var(--color-fg)",
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### Phase 0 hello tests (각 패키지)

`packages/shared/src/__tests__/hello.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
describe("shared", () => { it("loads", () => { expect(1 + 1).toBe(2); }); });
```

`packages/interfaces/src/__tests__/hello.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
describe("interfaces", () => { it("loads", () => { expect(true).toBe(true); }); });
```

`apps/server/src/__tests__/hello.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
describe("server", () => { it("loads", () => { expect(1 + 1).toBe(2); }); });
```

`apps/web/src/__tests__/hello.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
describe("web", () => { it("loads", () => { expect(1 + 1).toBe(2); }); });
```

### `packages/interfaces/src/index.ts` (Phase 0 빈 barrel — Phase 0.5 가 본문 채움)
```typescript
// Phase 0 시점: 빈 barrel — typecheck 통과만 보장.
// Phase 0.5 의 Contract Bootstrap PR 이 12 contract 파일을 추가하고 본 파일을 export 추가.
export {};
```

### `packages/shared/src/index.ts` (Phase 0 빈 barrel)
```typescript
export {};
```

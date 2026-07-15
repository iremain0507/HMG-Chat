# WChat

**WChat** is an internal enterprise LLM agent chat platform for **Hyundai WIA**. It delivers agentic chat with tools, knowledge/RAG grounded in citations, generated artifacts, MCP connectors, reusable skills, and human-in-the-loop (HITL) approvals — all streamed to the browser over SSE. The frontend follows the Hyundai WIA corporate identity (CI); the whole stack runs fully local for development and targets AWS for deployment.

## Key features

- **Agentic chat + tools** — a single streaming turn loop (`runTurn`) that calls the LLM, runs built-in tools (`artifact_create`, `web_search`, `code_interpreter`, `deep_research`) in parallel or serially, and re-invokes until done.
- **Knowledge / RAG with citations** — project + session document indexing (pgvector HNSW + BM25, RRF fusion) with citation-grounded answers; hallucinated citation markers are dropped.
- **Artifacts** — model-generated files persisted inline or via object storage, with owner-only sharing and signed download URLs.
- **MCP connectors** — per-request, org-scoped MCP tools with SSRF re-validation on every discover/invoke; HITL-by-default.
- **Skills** — versioned, manifest-driven skill packs the agent can load.
- **HITL approvals** — sensitive tool calls pause for an explicit approve/deny/timeout round-trip.
- **SSE streaming** — every chat event (text, tool progress, citations, artifacts) streams live, with Stop/abort and resume.
- **Hyundai WIA CI design** — all UI uses semantic design tokens per `apps/web/DESIGN.md`.

## Tech stack

| Layer   | Technology                                           |
| ------- | ---------------------------------------------------- |
| Web     | Next.js 15 (App Router) · React 19 · Tailwind v4     |
| API     | Hono 4.6 · TypeScript · SSE                          |
| Data    | PostgreSQL 16 + pgvector · Redis · Drizzle (client)  |
| Worker  | Python 3.12 · Poetry · FastAPI (document conversion) |
| Tooling | pnpm 10 workspaces · Turborepo · Vitest · Playwright |

## Monorepo layout

| Path                    | Description                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/server`           | `@wchat/server` — Hono API, orchestrator, tools, MCP, knowledge/RAG, DB migrations (port 4000) |
| `apps/web`              | `@wchat/web` — Next.js 15 frontend, Hyundai WIA CI (port 3000)                                 |
| `apps/converter-worker` | Python/Poetry FastAPI worker (PPTX/DOCX→PDF, port 8000) — outside the pnpm workspace           |
| `packages/interfaces`   | `@wchat/interfaces` — frozen single source of truth for all TypeScript contracts               |
| `packages/shared`       | `@wchat/shared` — shared HTTP DTO schemas                                                      |
| `scripts/`              | Verify gates, dev/deploy hooks, load tests, autonomous build loop                              |
| `rebuild_plan/`         | Plan, interface, and API-contract docs                                                         |

## Prerequisites

- **Node.js >= 22** (see `engines` in `package.json`) and **pnpm 10** (`corepack enable`).
- **PostgreSQL 16 + pgvector** and **Redis**, either via the bundled Docker stack (`docker-compose.local.yml`) **or** a local Homebrew install (`postgresql@16` + `redis`) already serving `wchat_dev` on `5432`/`6379`. Either path is fine as long as `5432` serves `wchat_dev` (with pgvector) and `6379` serves Redis.
- **Env files** — the app requires `.env.local` at the repo root and in `apps/server` (`apps/web/.env.local` is optional); start from the tracked `.env.local.example` template. These hold `DATABASE_URL`, `REDIS_URL`, JWT secrets, and LOCAL_ONLY provider config. **They are gitignored and must never be committed.**
- _Optional:_ Python 3.12 + Poetry only if you need the converter-worker.

## Quickstart

```bash
# 1. Install dependencies (also wires the git pre-commit hook)
pnpm install

# 2. Create local env from the tracked template
cp .env.local.example .env.local
#    apps/server/.env.local is also required — see .env.local.example for the keys.

# 3. Bring up Postgres (pgvector) + Redis
docker compose -f docker-compose.local.yml up -d
#    (Skip if Homebrew postgresql@16 + redis already serve wchat_dev on 5432/6379.)

# 4. Apply migrations (drizzle-kit)
pnpm db:migrate

# 5. Start the dev servers (web:3000, server:4000)
pnpm dev
```

Then open **http://localhost:3000**. The first hit to `/login` compiles the route graph (~26s), then it's instant. On the `/login` page, click the **dev-login** link to sign in as **Dev User** (role `owner`, Dev Org) — no email round-trip needed. Dev-login is active only when `NODE_ENV !== production`.

- **Health checks:** `curl http://localhost:4000/health` and `curl http://localhost:4000/api/v1/_ping`.
- **External access (Tailscale):** the dev server binds all interfaces and auth uses relative redirects, so `http://<tailscale-ip>:3000` (e.g. `http://100.101.234.112:3000`) works without a localhost bounce.
- **With the converter-worker:** use `pnpm dev:full` instead of `pnpm dev` to also start the Python worker on port 8000 (needed for document conversion/upload).

## Testing & gates

| Command                          | Purpose                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm test`                      | Run all unit tests (server + web) via Turbo                                                 |
| `pnpm typecheck`                 | TypeScript typecheck across the workspace                                                   |
| `pnpm lint`                      | ESLint across the workspace                                                                 |
| `bash scripts/verify-gates.sh`   | The commit/CI oracle — typecheck + lint + test + state; **must exit 0 before every commit** |
| `bash scripts/verify-browser.sh` | Playwright headless smoke test of the web preview (port 3100)                               |

## Project docs

| Doc                                                                  | What it covers                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                       | System architecture overview                                    |
| [`CLAUDE.md`](CLAUDE.md)                                             | Agent/build rules, path ownership, hard rules                   |
| [`apps/web/DESIGN.md`](apps/web/DESIGN.md)                           | Hyundai WIA CI design system (single source of truth)           |
| [`rebuild_plan/14-INTERFACES.md`](rebuild_plan/14-INTERFACES.md)     | Type/interface contracts (single source of truth)               |
| [`rebuild_plan/16-API-CONTRACT.md`](rebuild_plan/16-API-CONTRACT.md) | REST / SSE API contract                                         |
| [`rebuild_plan/08-SPRINT-PLAN.md`](rebuild_plan/08-SPRINT-PLAN.md)   | Phase / sprint task plan                                        |
| `/run-local` skill                                                   | One-shot local dev bring-up helper (`.claude/skills/run-local`) |

## Deployment

Local development is **LOCAL_ONLY** (Voyage embeddings, S3, E2B sandbox, and web search run as dev-stubs); **AWS** is the deploy target — swap the LOCAL_ONLY stubs for real providers at deploy time.

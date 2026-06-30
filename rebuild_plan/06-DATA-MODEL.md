# 06 · Data Model — 도메인 & DB 스키마

## 도메인 다이어그램 (개략)

```
Organization
  └─ OrgUnit (부서/팀, 계층)
      └─ User (M:N via user_org_units)
           ├─ Session ── Message
           │              └─ ToolCall / Artifact
           ├─ UserMemory (4 categories)
           ├─ Quota
           └─ UsageLog

Organization
  └─ Project (visibility: private/team/org)
       ├─ ProjectMember (User × role)
       ├─ ProjectDocument
       │   └─ DocumentChunk (vector + bm25)
       └─ Session (project context)

Organization
  └─ McpServer (org/project/user scope)

Artifact
  └─ ArtifactRevision (version history)
  └─ ArtifactShare (token, expires)

System-wide:
  ErrorLog, ToolMetric, HealthCheckResult, AlertEvent
```

## 핵심 테이블 (DDL 요약)

> 모든 테이블에 `created_at TIMESTAMPTZ DEFAULT NOW()`, `updated_at TIMESTAMPTZ DEFAULT NOW()` 의무.
> RLS 적용 테이블에는 `org_id UUID NOT NULL` (또는 추적 가능한 부모 키).
> 새 컬럼은 기본 nullable (L03).

### 1. Identity & Access

#### organizations
```sql
id UUID PK
name TEXT NOT NULL
domain TEXT NOT NULL UNIQUE          -- {{ORG_DOMAIN}}
plan TEXT DEFAULT 'standard'
allowed_models JSONB DEFAULT '[]'    -- ['claude-opus-4', ...]
allowed_tools JSONB DEFAULT '[]'
default_token_budget_micros BIGINT
```

#### org_units
```sql
id UUID PK
org_id UUID FK organizations NOT NULL
parent_id UUID FK org_units NULL     -- 트리 구조
name TEXT NOT NULL
path_key TEXT NOT NULL               -- '/HQ/AI팀'
INDEX (org_id, path_key)
```

#### users
```sql
id UUID PK
org_id UUID FK organizations NOT NULL
email CITEXT UNIQUE NOT NULL         -- 도메인 검증은 app level
name TEXT
role TEXT DEFAULT 'member'           -- member/admin/owner
custom_instructions TEXT NULL        -- User-level prompt
status TEXT DEFAULT 'active'
last_login_at TIMESTAMPTZ NULL
```

#### user_org_units (M:N)
```sql
user_id UUID FK users
org_unit_id UUID FK org_units
membership_role TEXT DEFAULT 'member'
PRIMARY KEY (user_id, org_unit_id)
```

### 2. Sessions & Messages

#### sessions
```sql
id UUID PK
user_id UUID FK users NOT NULL
project_id UUID FK projects NULL     -- 선택적
title TEXT NULL                      -- title-generator
archived_at TIMESTAMPTZ NULL
last_message_at TIMESTAMPTZ NULL
INDEX (user_id, last_message_at DESC)
```

#### messages
```sql
id UUID PK
session_id UUID FK sessions NOT NULL
role TEXT NOT NULL                   -- user/assistant/system/tool
content JSONB NOT NULL               -- markdown + tool_calls + artifacts
tool_call_ids TEXT[]
parent_message_id UUID NULL          -- 가지 분기
tokens_in INT NULL
tokens_out INT NULL
cost_micros BIGINT NULL
INDEX (session_id, created_at)
```

#### sessions_active_runs
```sql
session_id UUID PK FK sessions
job_id UUID NOT NULL
status TEXT NOT NULL                 -- pending/running/cancelled/completed
pending_hitl JSONB NULL
started_at TIMESTAMPTZ
```

### 3. Projects & Knowledge

#### projects
```sql
id UUID PK
org_id UUID FK organizations NOT NULL
owner_id UUID FK users NOT NULL
name TEXT NOT NULL
description TEXT NULL
visibility TEXT NOT NULL             -- private/team/org
INDEX (org_id, visibility)
```

#### project_members
```sql
project_id UUID FK projects
user_id UUID FK users
role TEXT NOT NULL                   -- owner/editor/viewer
PRIMARY KEY (project_id, user_id)
```

#### project_documents
```sql
id UUID PK
project_id UUID FK projects NOT NULL
filename TEXT NOT NULL
content_hash TEXT NOT NULL           -- dedup
size_bytes BIGINT
mime_type TEXT
s3_key TEXT
index_status TEXT NOT NULL           -- pending/parsing/chunking/embedding/indexed/failed (6-state)
chunk_count INT DEFAULT 0
indexed_at TIMESTAMPTZ NULL
INDEX (project_id, index_status)
UNIQUE (project_id, content_hash)
```

#### document_chunks
```sql
id UUID PK
document_id UUID FK project_documents NOT NULL
chunk_index INT NOT NULL
content TEXT NOT NULL
token_count INT
embedding VECTOR(1024)               -- voyage-multilingual-2 dim (단일 결정, 14-INTERFACES.md §5)
content_tsv TSVECTOR                 -- bm25
metadata JSONB                       -- page/section/heading
INDEX USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)
INDEX USING gin (content_tsv)
-- 검색 시 SET LOCAL hnsw.ef_search = 40
```

### 4. Artifacts

#### artifacts
```sql
id UUID PK
session_id UUID FK sessions NULL     -- nullable (L03, share 후 session 삭제 가능)
created_by UUID FK users NOT NULL
type TEXT NOT NULL                   -- pptx/pdf/docx/xlsx/markdown/html
filename TEXT NOT NULL
size_bytes BIGINT
s3_key TEXT
storage_kind TEXT NOT NULL           -- inline / s3 (단일 출처: 16 § /artifacts/:id)
shared_at TIMESTAMPTZ NULL
INDEX (session_id, created_at)
```

#### artifact_revisions
```sql
artifact_id UUID FK artifacts
version INT NOT NULL
s3_key TEXT NOT NULL
diff_summary TEXT
PRIMARY KEY (artifact_id, version)
```

#### artifact_shares
```sql
id UUID PK
artifact_id UUID FK artifacts NOT NULL
token UUID UNIQUE NOT NULL           -- 122-bit
issued_by UUID FK users NOT NULL
expires_at TIMESTAMPTZ NOT NULL
revoked_at TIMESTAMPTZ NULL
view_count INT DEFAULT 0
INDEX (token)
INDEX (expires_at) WHERE revoked_at IS NULL
```

### 5. Memory

#### user_memories
```sql
id UUID PK
user_id UUID FK users NOT NULL
category TEXT NOT NULL               -- user/feedback/project/reference
content TEXT NOT NULL
source TEXT NOT NULL                 -- auto-extract / manual
session_id UUID FK sessions NULL
pinned BOOLEAN DEFAULT FALSE
metadata JSONB
INDEX (user_id, category, pinned DESC)
```

#### memory_extraction_locks (Redis-like, but in DB for durability)
```sql
session_id UUID PK
locked_at TIMESTAMPTZ
expires_at TIMESTAMPTZ
```

### 6. Skills & MCP

#### mcp_servers
```sql
id UUID PK
org_id UUID FK organizations NOT NULL
project_id UUID FK projects NULL     -- scoped
user_id UUID FK users NULL           -- user-scoped
name TEXT NOT NULL
url TEXT NOT NULL
transport TEXT NOT NULL              -- streamable_http / sse
auth_header_name TEXT NULL
auth_secret_arn TEXT NULL            -- Secrets Manager ARN
supported_tools JSONB DEFAULT '[]'
last_discovered_at TIMESTAMPTZ NULL
status TEXT DEFAULT 'active'
INDEX (org_id, project_id, user_id)
```

#### skill_assets
```sql
id UUID PK
skill_id TEXT NOT NULL               -- '{{BRAND_PPTX_SKILL_NAME}}@1.0.0'
filename TEXT NOT NULL
content_type TEXT
size_bytes BIGINT
s3_key TEXT
PRIMARY KEY (skill_id, filename)
```

### 7. Quota & Observability

#### user_quotas
```sql
user_id UUID PK FK users
budget_micros BIGINT NOT NULL
used_micros BIGINT DEFAULT 0
period_start TIMESTAMPTZ NOT NULL
period_end TIMESTAMPTZ NOT NULL
```

#### usage_logs
```sql
id BIGSERIAL PK
user_id UUID FK users
org_id UUID FK organizations
session_id UUID NULL
provider TEXT                        -- anthropic/openai/gemini
model TEXT
tokens_in INT
tokens_out INT
cost_micros BIGINT
created_at TIMESTAMPTZ
INDEX (user_id, created_at)
INDEX (org_id, created_at)
```

#### tool_metrics
```sql
id BIGSERIAL PK
tool_name TEXT NOT NULL
status TEXT NOT NULL                 -- ok/error/timeout
duration_ms INT
user_id UUID NULL
org_id UUID NULL
created_at TIMESTAMPTZ
INDEX (tool_name, created_at)
```

#### error_logs
```sql
id BIGSERIAL PK
level TEXT NOT NULL                  -- debug/info/warn/error/fatal
category TEXT NOT NULL               -- auth/tool/db/mcp/sandbox/...
message TEXT
context JSONB
request_id UUID
user_id UUID NULL
org_id UUID NULL
created_at TIMESTAMPTZ
INDEX (category, level, created_at DESC)
```

#### health_check_history
```sql
id BIGSERIAL PK
target TEXT NOT NULL                 -- 'rds' / 'redis' / 'e2b' / 'anthropic'
status TEXT NOT NULL                 -- healthy/degraded/down
latency_ms INT
context JSONB
created_at TIMESTAMPTZ
INDEX (target, created_at DESC)
```

#### alert_events
```sql
id UUID PK
rule_id TEXT NOT NULL
severity TEXT                        -- info/warn/critical
message TEXT
payload JSONB
created_at TIMESTAMPTZ
resolved_at TIMESTAMPTZ NULL
```

## RLS (Row Level Security)

PostgreSQL RLS 활성화 테이블:
- sessions, messages, artifacts, projects, project_members, project_documents, document_chunks, user_memories, mcp_servers, usage_logs, error_logs (org_id 또는 user_id 기반)

RLS policy 는 `current_setting('app.user_id')` 와 `current_setting('app.org_id')` 사용. middleware/rls-context.ts 가 모든 요청 시작 시 SET.

## 마이그레이션 순서 (v1.0 까지)

| # | 이름 | Phase |
|---|---|---|
| 0001 | identity (orgs, users, org_units, user_org_units) | Phase 1 |
| 0002 | sessions + messages | Phase 2 |
| 0003 | sessions_active_runs | Phase 2 |
| 0004 | projects + project_members | Phase 3 |
| 0005 | project_documents + document_chunks (pgvector + tsvector) | Phase 4 |
| 0006 | artifacts + artifact_revisions | Phase 5 |
| 0007 | artifact_shares | Phase 6 |
| 0008 | user_memories + memory_extraction_locks | Phase 7 |
| 0009 | mcp_servers + skill_assets | Phase 8 |
| 0010 | user_quotas + usage_logs | Phase 9 |
| 0011 | error_logs + tool_metrics + health_check_history + alert_events | Phase 9 |
| 0012 | password_hash + magic_link_tokens | Phase 1 (auth flow 확정 후) |
| 0013 | refresh_token_families (rotation 추적) | Phase 1 |
| 0014 | uploads (세션 첨부 파일) | Phase 4 (`routes/uploads.ts` 와 동시) |
| 0015 | projects.org_unit_id FK (team scope) + project RLS read/write 분리 | Phase 3 직후 |
| 0016 | indexes / vacuum settings | Phase 9 끝 |
| 0017~ | 운영 중 점진적 추가 (nullable-first 원칙) |

> **RLS policy 는 별도 마이그레이션 아님**. 각 마이그레이션(0001~0011, 0013, 0014, 0015) 안에 해당 테이블의 RLS ENABLE + policy 가 임베디드되어 있음 ([§ 부록 A](#부록-a--마이그레이션-0001-풀-본문), [§ 부록 F](#부록-f--마이그레이션-00020016-본문) 의 각 SQL 끝부분 참조).
>
> - **0013 (refresh_token_families)**: RLS ENABLE + `rtf_owner` policy (USING: `user_id = app.user_id`). insert 시점에 `SET LOCAL app.user_id` 가 이미 설정돼 있어야 함 → auth/login flow 가 access token 발급 직후 `SET LOCAL` 후 family insert. signup verify 흐름에서는 user row insert 직후 동일 트랜잭션에서 `SET LOCAL app.user_id = <new user.id>` 후 family insert.
> - **0012 (magic_link_tokens)**: RLS 적용 안 함 (signup 흐름에서 user 가 아직 없어 app.user_id 가 없음 — server 가 SECURITY DEFINER 트랜잭션으로 처리).
> - **0016 (indexes/vacuum)**: 인덱스/스토리지 튜닝만이라 RLS 무관.
>
> 별도 "RLS-only" 마이그레이션은 없다.

## 신규 컬럼 추가 정책 (L03)

```
1. nullable 로 추가 (default null)
2. application 코드 양쪽 호환 (없을 수 있다는 가정)
3. 백필 (필요 시) — 별도 마이그레이션
4. NOT NULL 로 전환 — 별도 마이그레이션 (백필 후)
```

각 단계는 다른 MR 으로 분리.

## 도메인 서비스 (database service 레이어)

`apps/server/src/db/*-service.ts` 가 비즈니스 도메인 단위로 SQL 추상화. 라우트는 service 만 호출 (직접 SQL 금지).

| 서비스 | 책임 |
|---|---|
| `auth-service.ts` | 사용자 생성/조회, 도메인 검증 |
| `session-service.ts` | 세션 CRUD + lock |
| `message-service.ts` | 메시지 CRUD + 검색 |
| `project-service.ts` | 프로젝트 + 멤버십 |
| `document-service.ts` | 문서 업로드 + 인덱싱 상태 |
| `chunk-service.ts` | 청크 hybrid search |
| `artifact-service.ts` | artifact CRUD (db / s3 라우팅) |
| `artifact-share-service.ts` | 공유 토큰 발급/revoke |
| `memory-service.ts` | 메모리 CRUD + 검색 + pin |
| `mcp-server-service.ts` | MCP 등록/scope |
| `quota-service.ts` | 할당량 확인/차감 |
| `usage-logger.ts` | usage_logs append |
| `error-logger.ts` | error_logs append (typed) |

각 서비스는 [packages/interfaces/DataAccess.ts](14-INTERFACES.md#3-dataaccess) 를 따른 interface + impl 분리 — 테스트 시 InMemory impl 로 갈아끼움.

---

## 부록 A · 마이그레이션 0001 풀 본문

`apps/server/src/db/migrations/0001_identity.sql`:

```sql
-- 0001 · Identity & RLS skeleton
-- 적용 시점: Phase 1 시작 직후

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─── organizations ───
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'standard',
  allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_token_budget_micros BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX organizations_domain_idx ON organizations(domain);

-- ─── org_units (트리) ───
CREATE TABLE org_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  path_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_units_path_unique UNIQUE (org_id, path_key)
);

CREATE INDEX org_units_org_idx ON org_units(org_id);
CREATE INDEX org_units_parent_idx ON org_units(parent_id);

-- ─── users ───
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin','owner')),
  custom_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_org_idx ON users(org_id);

-- ─── user_org_units (M:N) ───
CREATE TABLE user_org_units (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_unit_id UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'member'
    CHECK (membership_role IN ('member','lead','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_unit_id)
);

CREATE INDEX user_org_units_unit_idx ON user_org_units(org_unit_id);

-- ─── RLS 활성화 + FORCE (table owner 도 우회 못 함) ───
-- ENABLE 만 하면 BYPASSRLS 권한이나 table owner 는 우회 가능. FORCE 까지 추가해야 마스터/migrator/owner 도 policy 통과 의무.
-- 정책: master/migrator credential 은 ALTER/CREATE/DROP 용 — 일상 query 에 사용 금지.
-- 일상 query 는 app_user (BYPASSRLS 없음, owner 아님) 로 수행 → RLS 강제.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE  ROW LEVEL SECURITY;
ALTER TABLE org_units     ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_units     FORCE  ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_org_units FORCE  ROW LEVEL SECURITY;

-- ─── RLS helper function (자기참조 재귀 회피용) ───
-- RLS policy 안에서 `EXISTS (SELECT FROM users ...)` 를 직접 쓰면 같은 테이블의
-- RLS policy 가 재진입 → 무한 재귀. SECURITY DEFINER function 으로 RLS 우회 조회.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT role FROM users WHERE id = current_setting('app.user_id', true)::uuid;
$$;

CREATE OR REPLACE FUNCTION current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT current_user_role() IN ('admin','owner');
$$;

-- project_members 자기참조 회피 (0004/0015 의 pm_modify 등에서 사용)
-- ⚠️ Forward reference: project_members 는 0004 에서 생성됨.
--    PostgreSQL `LANGUAGE sql` 은 정의 시점에 referenced object resolve 를 시도하므로
--    0001 에선 **stub** 으로 정의 (NULL 반환), 0004 가 `CREATE OR REPLACE` 로 본문 교체.
--    LANGUAGE plpgsql 은 동적 lookup → forward reference OK. 본 함수도 plpgsql 로 두면 더 단순.
CREATE OR REPLACE FUNCTION user_role_in_project(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 0004 이전엔 project_members 가 없어 NULL 반환 — RLS 결과는 어떤 policy 도 통과 안 됨.
  -- 0004 적용 후 본 EXECUTE 가 실제 role 을 반환.
  BEGIN
    EXECUTE 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = current_setting(''app.user_id'', true)::uuid'
      INTO v_role USING p_project_id;
  EXCEPTION
    WHEN undefined_table THEN
      v_role := NULL;  -- 0001~0003 시점 fallback
  END;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION user_is_project_owner(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT user_role_in_project(p_project_id) = 'owner';
$$;

CREATE OR REPLACE FUNCTION user_is_project_editor_or_owner(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT user_role_in_project(p_project_id) IN ('owner','editor');
$$;

REVOKE EXECUTE ON FUNCTION current_user_role()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION current_user_is_admin()                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_role_in_project(UUID)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_is_project_owner(UUID)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_is_project_editor_or_owner(UUID)    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION current_user_role()                      TO PUBLIC;
GRANT  EXECUTE ON FUNCTION current_user_is_admin()                  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_role_in_project(UUID)               TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_is_project_owner(UUID)              TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_is_project_editor_or_owner(UUID)    TO PUBLIC;

-- ─── RLS policy ───
-- 모든 정책은 미들웨어가 SET LOCAL 한 두 값을 참조:
--   SET LOCAL app.user_id = '<uuid>';
--   SET LOCAL app.org_id  = '<uuid>';
-- 미들웨어는 매 요청을 BEGIN/COMMIT 트랜잭션으로 감싸 SET LOCAL 의 범위를 보장.

CREATE POLICY organizations_select ON organizations
  FOR SELECT
  USING (id = current_setting('app.org_id', true)::uuid);

CREATE POLICY organizations_modify_admin ON organizations
  FOR ALL
  USING (
    id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()                 -- SECURITY DEFINER 함수, RLS 우회
  );

CREATE POLICY org_units_select ON org_units
  FOR SELECT
  USING (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY org_units_modify ON org_units
  FOR ALL
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()
  );

CREATE POLICY users_select_same_org ON users
  FOR SELECT
  USING (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (id = current_setting('app.user_id', true)::uuid);

CREATE POLICY users_admin_modify ON users
  FOR ALL
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()                 -- 같은 테이블 자기참조 회피
  );

CREATE POLICY user_org_units_select ON user_org_units
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM org_units ou
      WHERE ou.id = user_org_units.org_unit_id
        AND ou.org_id = current_setting('app.org_id', true)::uuid
    )
  );

-- ─── trigger: updated_at 자동 갱신 ───
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER org_units_touch BEFORE UPDATE ON org_units
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

### Down (rollback)

Drizzle 은 자동 down 없음. 운영 정책상 PROD 에는 rollback 안 함 (forward only). 그러나 dev/staging 에서는 다음 down 스크립트 보관:

```sql
DROP TRIGGER users_touch ON users;
DROP TRIGGER org_units_touch ON org_units;
DROP TRIGGER organizations_touch ON organizations;
DROP FUNCTION touch_updated_at();

DROP POLICY user_org_units_select ON user_org_units;
DROP POLICY users_admin_modify ON users;
DROP POLICY users_update_self ON users;
DROP POLICY users_select_same_org ON users;
DROP POLICY org_units_modify ON org_units;
DROP POLICY org_units_select ON org_units;
DROP POLICY organizations_modify_admin ON organizations;
DROP POLICY organizations_select ON organizations;

DROP TABLE user_org_units;
DROP TABLE users;
DROP TABLE org_units;
DROP TABLE organizations;
```

## 부록 B · 컬럼 default / convention

- 모든 PK: `UUID DEFAULT uuid_generate_v4()` (application layer 가 미리 생성한 경우는 그것 사용)
- 모든 timestamp: `TIMESTAMPTZ NOT NULL DEFAULT NOW()` (created_at), 또는 nullable (updated_at 외)
- `updated_at` 은 위 `touch_updated_at` trigger 가 자동 갱신
- `email` 은 항상 `CITEXT` (대소문자 무관)
- 모든 enum 값은 CHECK constraint (Postgres ENUM 대신 — 변경 유연성)

## 부록 C · memory_category enum

`user_memories.category` 의 값:
- `user` — 사용자 본인의 영구 지시사항 ("나는 영업 담당")
- `feedback` — 사용자가 {{PROJECT_NAME}} 응답에 준 피드백 ("이건 더 짧게")
- `project` — 특정 프로젝트 컨텍스트 ("프로젝트 X 는 Y 시장 진입")
- `reference` — 외부 참고 자료/링크 ("이 문서를 항상 참조")

(02-PRODUCT-VISION.md persona / analysis/REPORT.md MR !14 가 본 enum 을 인용).

## 부록 D · 검색 hybrid score 공식

```
rrfScore = 1 / (rrfK + vectorRank) + 1 / (rrfK + bm25Rank)
```
- `rrfK = 60` (기본)
- 두 검색의 결과 union, 각 결과의 rrfScore 합산
- topK 까지 sort

## 부록 E · token cost 계산식 (I14 보완)

```
costMicros = (tokensIn * priceInPerMillion + tokensOut * priceOutPerMillion) * 1
// price 단위: USD per 1M tokens × 1_000_000 → micro-USD per token
// cache hit 의 경우 priceInPerMillion 의 10% (provider 별 상이)
```

provider × model 단가 (2026-Q2 기준 — `apps/server/src/lib/llm-pricing.ts` 단일 출처):
| Model | Input ($/1M) | Output ($/1M) | Cache read ($/1M) |
|---|---:|---:|---:|
| claude-opus-4-7 | 15.00 | 75.00 | 1.50 |
| claude-sonnet-4-6 | 3.00 | 15.00 | 0.30 |
| claude-haiku-4-5 | 0.80 | 4.00 | 0.08 |
| gpt-4o | 5.00 | 15.00 | n/a |
| gemini-pro-vision | 1.25 | 5.00 | n/a |
| voyage-multilingual-2 (embedding) | 0.12 | n/a | n/a |

(실제 가격은 provider 변경되면 본 표 1군데만 수정.)

---

## 부록 F · 마이그레이션 0002~0016 본문

> 본 부록의 모든 SQL 은 0001 의 패턴(extension 활성화, NOT NULL DEFAULT, FK 의 ON DELETE 명시, RLS ENABLE, policy 4개, trigger) 을 따른다. 신규 컬럼 default 정책은 본 문서 § 부록 B.
> 포함 마이그레이션: 0002~0011 (도메인 테이블), 0012/0013 (auth 토큰), 0014/0015 (uploads + project team scope), 0016 (indexes/vacuum).

### `0002_sessions_messages.sql`

```sql
-- 주의: project_id 컬럼은 본 마이그레이션에서 nullable UUID 로만 만들고,
-- FK constraint 는 0004 끝부분에서 추가 (projects 테이블 생성 후).

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID,                                              -- FK 는 0004 에서 추가
  title TEXT,
  archived_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_lastmsg_idx ON sessions(user_id, last_message_at DESC);
CREATE TRIGGER sessions_touch BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content JSONB NOT NULL,
  tool_call_ids TEXT[],
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tokens_in INT,
  tokens_out INT,
  cost_micros BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_session_created_idx ON messages(session_id, created_at);
CREATE INDEX sessions_project_idx ON sessions(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- sessions: 본인 세션만
CREATE POLICY sessions_owner ON sessions
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- messages: 자신의 세션 안의 메시지만
CREATE POLICY messages_via_session ON messages
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = messages.session_id
      AND s.user_id = current_setting('app.user_id', true)::uuid
  ));
```

> 위 0002 본문은 **실행 가능한 상태** — project_id 는 nullable UUID 컬럼만, FK 는 0004 끝부분 (`ALTER TABLE sessions ADD CONSTRAINT sessions_project_fk ...`) 에서 추가.

### `0003_sessions_active_runs.sql`

```sql
CREATE TABLE sessions_active_runs (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  job_id UUID NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','cancelled','completed')),
  pending_hitl JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER sessions_active_runs_touch BEFORE UPDATE ON sessions_active_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE sessions_active_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY active_runs_via_session ON sessions_active_runs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = sessions_active_runs.session_id
      AND s.user_id = current_setting('app.user_id', true)::uuid
  ));
```

### `0004_projects_members.sql`

```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private','team','org')),
  -- org_unit_id: visibility='team' 일 때만 의미. 0005 의 RLS 가 본 컬럼 참조 → 0004 에 미리 추가.
  -- 0015 는 RLS read/write 분리 정책만 담당 (컬럼은 본 마이그레이션에서 도입).
  org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projects_team_orgunit_required
    CHECK (visibility <> 'team' OR org_unit_id IS NOT NULL)
);
CREATE INDEX projects_org_unit_idx ON projects(org_unit_id) WHERE org_unit_id IS NOT NULL;
CREATE INDEX projects_org_visibility_idx ON projects(org_id, visibility);
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- sessions.project_id 의 FK 연결 (0002 에서 컬럼만 만든 상태)
ALTER TABLE sessions ADD CONSTRAINT sessions_project_fk
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- projects: visibility 매트릭스 (08-SPRINT-PLAN.md § Phase 3 visibility 매트릭스)
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND (
      visibility IN ('org','team')                                 -- org 내 누구나
      OR EXISTS (                                                  -- 또는 멤버
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = current_setting('app.user_id', true)::uuid
      )
    )
  );

-- INSERT: 0004 에 미리 정의 — Phase 3 POST /projects 가 0015 적용 전에도 동작.
-- 0015 가 본 policy 를 DROP + 재정의 (org_unit 검증 추가) 하지만 0004 만으로도 RLS 통과 안전.
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (
    org_id = current_setting('app.org_id', true)::uuid
    AND owner_id = current_setting('app.user_id', true)::uuid
  );

CREATE POLICY projects_modify_member ON projects
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role IN ('owner','editor')
  ));

CREATE POLICY projects_delete_owner ON projects
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role = 'owner'
  ));

CREATE POLICY project_members_select ON project_members
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = project_members.project_id
      AND p.org_id = current_setting('app.org_id', true)::uuid
  ));

CREATE POLICY project_members_modify_owner ON project_members
  FOR ALL
  USING (user_is_project_owner(project_id))     -- SECURITY DEFINER, 재귀 회피
  WITH CHECK (user_is_project_owner(project_id));

-- 최초 owner row bootstrap — 위 pm_modify 정책이 self-referential 이라
-- POST /projects 의 첫 row 가 deny 됨. SECURITY DEFINER 함수로 정책 우회.
-- server 의 createProjectWithOwner() 가 본 함수만 호출 — 다른 경로로는 호출 금지.
CREATE OR REPLACE FUNCTION bootstrap_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- 함수 호출자가 새 project 의 actual creator 인지 검증 (다른 user 가 자기 user_id 로 호출 차단)
  IF p_user_id <> current_setting('app.user_id', true)::uuid THEN
    RAISE EXCEPTION 'bootstrap_project_owner: user_id mismatch with app.user_id';
  END IF;
  -- 해당 project 가 이미 owner 가 있으면 거부 (중복 호출 방지)
  IF EXISTS (SELECT 1 FROM project_members
             WHERE project_id = p_project_id AND role = 'owner') THEN
    RAISE EXCEPTION 'bootstrap_project_owner: project % already has owner', p_project_id;
  END IF;
  INSERT INTO project_members (project_id, user_id, role)
    VALUES (p_project_id, p_user_id, 'owner');
END;
$$;
REVOKE EXECUTE ON FUNCTION bootstrap_project_owner(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION bootstrap_project_owner(UUID, UUID) TO PUBLIC;
-- 보안: SECURITY DEFINER 라도 위 두 check (user_id match + no existing owner) 가 권한 우회 방지.
```

### `0005_documents_chunks.sql`

```sql
-- 컬럼 spec: 14-INTERFACES § ProjectDocumentRecord 와 1:1 일치 (단일 출처).
CREATE TABLE project_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,                           -- 14-INTERFACES 는 non-null. upload 시점에 결정 필수.
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,                              -- raw upload location, presigned URL 생성용
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- 6-state: 14-INTERFACES § ProjectDocumentRecord + 16-API-CONTRACT § IndexStatus 단일 출처.
  index_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (index_status IN ('pending','parsing','chunking','embedding','indexed','failed')),
  chunk_count INT NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ,
  failure_reason TEXT,                                -- index_status='failed' 일 때 사용자에게 노출. NULL = OK.
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_documents_dedup UNIQUE (project_id, content_hash)
);
CREATE INDEX project_documents_project_status_idx ON project_documents(project_id, index_status);
CREATE TRIGGER project_documents_touch BEFORE UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT,
  embedding VECTOR(1024),                  -- voyage-multilingual-2
  content_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,   -- 14 § DocumentChunk.metadata 와 일관 (NOT NULL Record<string, unknown>)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX document_chunks_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin(content_tsv);

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks   ENABLE ROW LEVEL SECURITY;

-- 0005 본문은 0015 의 refine 과 동일한 최종 정책을 처음부터 적용.
-- fresh DB (0005 적용 직후) 와 incremental DB (0005 → 0015 순) 의 RLS 결과가 동일하도록 보장.
-- user_can_read_project / user_can_write_project 는 0015 에서 정의되지만, 0005 시점에 아직 없을 수 있으므로
-- 본 마이그레이션 도입부에 함수도 CREATE OR REPLACE 로 같이 정의 (0015 가 다시 한 번 REPLACE 해도 동일).

CREATE OR REPLACE FUNCTION user_can_read_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.org_id = current_setting('app.org_id', true)::uuid
      AND (
        p.visibility = 'org'
        OR (p.visibility = 'team' AND p.org_unit_id IN (
          SELECT org_unit_id FROM user_org_units
          WHERE user_id = current_setting('app.user_id', true)::uuid))
        OR EXISTS (SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id
                     AND pm.user_id = current_setting('app.user_id', true)::uuid)
      )
  );
$$;

CREATE OR REPLACE FUNCTION user_can_write_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role IN ('owner','editor')
  );
$$;
REVOKE EXECUTE ON FUNCTION user_can_read_project(UUID)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_can_write_project(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_read_project(UUID)  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_write_project(UUID) TO PUBLIC;

-- project_documents: SELECT 는 read 권한, INSERT/UPDATE/DELETE 는 write 권한 (0015 와 동일)
CREATE POLICY pd_select ON project_documents
  FOR SELECT USING (user_can_read_project(project_id));
CREATE POLICY pd_insert ON project_documents
  FOR INSERT WITH CHECK (user_can_write_project(project_id));
CREATE POLICY pd_update ON project_documents
  FOR UPDATE USING (user_can_write_project(project_id))
              WITH CHECK (user_can_write_project(project_id));
CREATE POLICY pd_delete ON project_documents
  FOR DELETE USING (user_can_write_project(project_id));

-- document_chunks: 부모 document 의 권한 따름 (0015 와 동일)
CREATE POLICY dc_select ON document_chunks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_read_project(pd.project_id)));
CREATE POLICY dc_insert ON document_chunks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));
CREATE POLICY dc_update ON document_chunks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)))
  WITH CHECK (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));
CREATE POLICY dc_delete ON document_chunks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));

-- 결과: 0005 직후 fresh DB 와 0005 → 0015 incremental DB 가 같은 정책 12개를 가짐.
-- 0015 의 DO $$ guard 는 "이미 0005 가 만든 정책" 을 발견하면 duplicate_object exception → NOTICE skip.
```

### `0006_artifacts.sql`

```sql
CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,   -- nullable (L03)
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('pptx','pdf','docx','xlsx','markdown','html','image','other')),
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,                                  -- 14/16 Artifact DTO 의 sizeBytes 와 일관 (non-null). inline 도 byte length 필수.
  s3_key TEXT,
  -- 14-INTERFACES § ArtifactStore + 16-API-CONTRACT § storage_kind 분기 정책 단일 출처.
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline','s3')),
  inline_content BYTEA,                    -- storage_kind='inline' 인 경우 (DB BYTEA)
  shared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (storage_kind = 'inline' AND inline_content IS NOT NULL AND s3_key IS NULL) OR
    (storage_kind = 's3'     AND s3_key IS NOT NULL AND inline_content IS NULL)
  )
);
CREATE INDEX artifacts_session_created_idx ON artifacts(session_id, created_at);
CREATE INDEX artifacts_creator_idx ON artifacts(created_by);
CREATE TRIGGER artifacts_touch BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE artifact_revisions (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  s3_key TEXT NOT NULL,
  diff_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artifact_id, version)
);

ALTER TABLE artifacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_owner_or_session ON artifacts
  FOR ALL
  USING (
    created_by = current_setting('app.user_id', true)::uuid
    OR EXISTS (SELECT 1 FROM sessions s
               WHERE s.id = artifacts.session_id
                 AND s.user_id = current_setting('app.user_id', true)::uuid)
  );

CREATE POLICY artifact_revisions_via_artifact ON artifact_revisions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.id = artifact_revisions.artifact_id
      AND (a.created_by = current_setting('app.user_id', true)::uuid
           OR EXISTS (SELECT 1 FROM sessions s
                      WHERE s.id = a.session_id
                        AND s.user_id = current_setting('app.user_id', true)::uuid))
  ));
```

### `0007_artifact_shares.sql`

```sql
CREATE TABLE artifact_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  token UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  issued_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  view_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX artifact_shares_token_idx ON artifact_shares(token);
CREATE INDEX artifact_shares_active_idx
  ON artifact_shares(expires_at)
  WHERE revoked_at IS NULL;

-- RLS 는 발급자 본인 또는 같은 org 의 admin 만 share 정보 조회/관리.
-- public /share/<token> 호출은 별도 service-role connection (RLS 우회) 사용.
-- admin branch: same org 의 admin/owner role 이면 모든 share 조회 가능 (org boundary 는 artifact join 으로 강제 — admin 이 다른 org 의 share 못 봄).
ALTER TABLE artifact_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY artifact_shares_issuer_or_admin ON artifact_shares
  FOR ALL
  USING (
    issued_by = current_setting('app.user_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM users u
      JOIN artifacts a ON a.id = artifact_shares.artifact_id
      JOIN users a_owner ON a_owner.id = a.created_by
      WHERE u.id = current_setting('app.user_id', true)::uuid
        AND u.role IN ('admin', 'owner')
        AND u.org_id = a_owner.org_id   -- 같은 org 만 admin 권한 인정
    )
  );
```

### `0008_user_memories.sql`

```sql
CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('user','feedback','project','reference')),
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto-extract','manual')),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_memories_user_cat_idx
  ON user_memories(user_id, category, pinned DESC, created_at DESC);
CREATE TRIGGER user_memories_touch BEFORE UPDATE ON user_memories FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE memory_extraction_locks (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE user_memories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extraction_locks   ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_memories_owner ON user_memories
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid);

CREATE POLICY memory_locks_via_session ON memory_extraction_locks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = memory_extraction_locks.session_id
      AND s.user_id = current_setting('app.user_id', true)::uuid
  ));
```

### `0009_mcp_servers_skills.sql`

```sql
CREATE TABLE mcp_servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('streamable_http','sse')),
  auth_header_name TEXT,
  auth_secret_arn TEXT,
  supported_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_discovered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX mcp_servers_scope_idx ON mcp_servers(org_id, project_id, user_id);
CREATE TRIGGER mcp_servers_touch BEFORE UPDATE ON mcp_servers FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE skill_assets (
  skill_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  s3_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (skill_id, filename)
);

ALTER TABLE mcp_servers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY mcp_servers_scope ON mcp_servers
  FOR SELECT
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND (
      (project_id IS NULL AND user_id IS NULL)                                              -- org 전체 공유
      OR user_id = current_setting('app.user_id', true)::uuid                               -- user-scoped
      OR EXISTS (SELECT 1 FROM project_members pm                                           -- project-scoped
                 WHERE pm.project_id = mcp_servers.project_id
                   AND pm.user_id = current_setting('app.user_id', true)::uuid)
    )
  );

CREATE POLICY mcp_servers_modify_admin ON mcp_servers
  FOR ALL
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND (
      user_id = current_setting('app.user_id', true)::uuid
      OR current_user_is_admin()
    )
  );

CREATE POLICY skill_assets_read_anyone ON skill_assets
  FOR SELECT USING (TRUE);                       -- public 읽기 OK (실제 보안은 application level)
CREATE POLICY skill_assets_modify_admin ON skill_assets
  FOR ALL
  USING (current_user_is_admin());
```

### `0010_quotas_usage.sql`

```sql
CREATE TABLE user_quotas (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  budget_micros BIGINT NOT NULL,
  used_micros BIGINT NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER user_quotas_touch BEFORE UPDATE ON user_quotas FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE usage_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  provider TEXT,
  model TEXT,
  tokens_in INT,
  tokens_out INT,
  cost_micros BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX usage_logs_user_created_idx ON usage_logs(user_id, created_at);
CREATE INDEX usage_logs_org_created_idx  ON usage_logs(org_id, created_at);

ALTER TABLE user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_quotas_owner ON user_quotas
  FOR SELECT USING (user_id = current_setting('app.user_id', true)::uuid);
CREATE POLICY user_quotas_admin_modify ON user_quotas
  FOR ALL
  USING (current_user_is_admin());

CREATE POLICY usage_logs_owner_or_admin ON usage_logs
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR (current_user_is_admin()
        AND org_id = current_setting('app.org_id', true)::uuid)
  );
```

### `0011_observability.sql`

```sql
CREATE TABLE error_logs (
  id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL CHECK (level IN ('debug','info','warn','error','fatal')),
  category TEXT NOT NULL CHECK (category IN ('auth','tool','db','mcp','sandbox','rate-limit','external-api','parser','orchestrator','http','system')),
  message TEXT,
  context JSONB,
  request_id UUID,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX error_logs_category_level_created_idx
  ON error_logs(category, level, created_at DESC);

CREATE TABLE tool_metrics (
  id BIGSERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok','error','timeout','denied','hitl-pending')),
  duration_ms INT,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX tool_metrics_tool_created_idx ON tool_metrics(tool_name, created_at);

CREATE TABLE health_check_history (
  id BIGSERIAL PRIMARY KEY,
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('healthy','degraded','down')),
  latency_ms INT,
  context JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX health_check_history_target_idx ON health_check_history(target, created_at DESC);

CREATE TABLE alert_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','warn','critical')),
  message TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX alert_events_severity_created_idx ON alert_events(severity, created_at DESC);

-- 운영 로그는 admin 만 조회 (RLS)
ALTER TABLE error_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_metrics         ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_check_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events         ENABLE ROW LEVEL SECURITY;

CREATE POLICY error_logs_admin ON error_logs FOR SELECT
  USING (current_user_is_admin());
CREATE POLICY tool_metrics_admin ON tool_metrics FOR SELECT
  USING (current_user_is_admin());
CREATE POLICY health_admin ON health_check_history FOR SELECT
  USING (current_user_is_admin());
CREATE POLICY alerts_admin ON alert_events FOR SELECT
  USING (current_user_is_admin());
-- INSERT/UPDATE 는 application 의 service role connection 이 RLS 우회 (BYPASSRLS 권한)
```

### `0012_password_or_magic.sql`

```sql
-- v1.0 결정: magic-link 우선 (password 는 admin 계정용으로만 유지)
ALTER TABLE users
  ADD COLUMN password_hash TEXT,                              -- bcrypt cost 12, NULL = magic-link only
  ADD COLUMN magic_link_salt TEXT;                            -- HMAC 입력

-- magic-link 토큰 (Redis primary, DB backup. signup 흐름에서는 user 가 아직 없을 수 있어 user_id nullable)
CREATE TABLE magic_link_tokens (
  token_hash TEXT PRIMARY KEY,                                -- sha256(token)
  email CITEXT NOT NULL,                                      -- signup 흐름 (user 미존재) 시 식별 키
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,        -- 기존 사용자면 채워짐
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, -- email 도메인 매칭으로 결정된 org. 14/16 MagicLinkTokenRecord.orgId (non-null) 와 일관.
  intent TEXT NOT NULL CHECK (intent IN ('signup','login')),
  signup_name TEXT,                                           -- intent='signup' 일 때 verify 시점에 users.name 으로 복원. NULL 허용 (login 흐름).
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX magic_link_tokens_email_idx ON magic_link_tokens(email)
  WHERE used_at IS NULL;
CREATE INDEX magic_link_tokens_expires_idx ON magic_link_tokens(expires_at)
  WHERE used_at IS NULL;

-- magic-link signup verify 시점에 새 user row 를 만드는 SECURITY DEFINER 함수.
-- 이유: 0001 의 users RLS (users_select_same_org / users_modify_self) 가 app.user_id 설정을 가정.
-- signup 흐름에선 user 가 아직 없어 app.user_id 미설정 → 일반 INSERT 가 RLS 에 막힘.
-- 본 함수가 (a) magic_link_tokens 검증 (token_hash + expiry + intent='signup' + 미사용) →
--          (b) users INSERT (org_id 는 token row 의 도메인 매칭으로 결정) →
--          (c) magic_link_tokens.used_at = NOW() → (d) 새 user.id 반환.
-- 호출자: apps/server/src/routes/auth.ts 의 magic-link verify handler.
-- 14-INTERFACES § MagicLinkTokenRepo 는 본 함수만 wrap (다른 경로로 user INSERT 금지).
CREATE OR REPLACE FUNCTION create_user_from_magic_link(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row magic_link_tokens%ROWTYPE;
  v_user_id UUID;
BEGIN
  -- 1) token row lock + 검증
  SELECT * INTO v_row FROM magic_link_tokens
    WHERE token_hash = p_token_hash
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'magic_link_token not found' USING ERRCODE = 'NO_DATA_FOUND';
  END IF;
  IF v_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'magic_link_token already used' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'magic_link_token expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.intent <> 'signup' THEN
    RAISE EXCEPTION 'create_user_from_magic_link: intent must be signup, got %', v_row.intent;
  END IF;
  IF v_row.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'create_user_from_magic_link: token already linked to user %', v_row.user_id;
  END IF;
  -- 2) users INSERT (RLS 우회 — SECURITY DEFINER 권한)
  INSERT INTO users (org_id, email, name, role, status)
    VALUES (v_row.org_id, v_row.email, COALESCE(v_row.signup_name, v_row.email), 'member', 'active')
    RETURNING id INTO v_user_id;
  -- 3) magic_link_tokens 의 user_id + used_at 갱신
  UPDATE magic_link_tokens
    SET user_id = v_user_id, used_at = NOW()
    WHERE token_hash = p_token_hash;
  RETURN v_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION create_user_from_magic_link(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_user_from_magic_link(TEXT) TO PUBLIC;
-- 보안: SECURITY DEFINER 이지만 위 검증 (token 존재 + 미사용 + 미만료 + intent='signup' + 미링크) 이 권한 우회 차단.
-- 호출 후 server 가 동일 트랜잭션 안에서 SET LOCAL app.user_id = <new id> 를 즉시 실행해야 후속 RLS 통과.
```

### `0013_refresh_token_families.sql`

```sql
-- JWT refresh rotation 의 family 추적 (12-OPS-SECURITY.md § 부록 A 의 도난 감지 정책 구현)
-- 각 family 안에서 한 번에 valid 한 refresh token 은 1개.
-- 같은 family 의 같은 generation 이 두 번 사용되면 → 도난 의심 → 전체 family revoke.

CREATE TABLE refresh_token_families (
  family_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_generation INT NOT NULL DEFAULT 1,                 -- rotate 시 +1
  current_jti UUID NOT NULL DEFAULT uuid_generate_v4(),      -- 현재 valid token 의 jti claim
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,                                    -- 도난 감지 또는 logout 시
  revoke_reason TEXT CHECK (revoke_reason IN ('theft_suspected','logout','admin','expired'))
);
CREATE INDEX refresh_token_families_user_active_idx
  ON refresh_token_families(user_id) WHERE revoked_at IS NULL;

ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY rtf_owner ON refresh_token_families
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- 도난 감지 흐름 (application code 가 호출):
-- 1. refresh 요청의 family_id + jti 검증
-- 2. current_jti 와 다르면 (= 이전 generation 의 token) → 도난 의심 → 전체 family revoke
-- 3. current_jti 와 같으면 → 새 jti 생성, current_generation++, last_used_at = NOW()
```

### `0014_uploads.sql`

```sql
-- 세션 첨부 파일 (project_documents 와 별개 — 단발성, 30일 만료)
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,                                       -- dedup + 무결성
  expires_at TIMESTAMPTZ NOT NULL,                            -- 30일 후 자동 정리
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uploads_user_sha_unique UNIQUE (user_id, sha256)
);
CREATE INDEX uploads_user_created_idx ON uploads(user_id, created_at DESC);
-- partial index 의 predicate 는 IMMUTABLE 함수만 허용 — NOW() 사용 불가.
-- 대신 단순 expires_at 인덱스 + cron job 이 `WHERE expires_at < NOW()` 로 조회.
CREATE INDEX uploads_expires_idx ON uploads(expires_at);

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 업로드만
CREATE POLICY uploads_owner_select ON uploads
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- INSERT/UPDATE/DELETE: 본인만
CREATE POLICY uploads_owner_modify ON uploads
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- 세션 ephemeral RAG 인덱스 — 채팅 첨부 파일의 chunk + embedding.
-- 16-API-CONTRACT § POST /sessions/:id/messages 의 RAG 흐름 단일 출처.
-- project_documents 와 다르게 session 종료 시 자동 cascade delete.
CREATE TABLE ephemeral_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  page_number INT,                                              -- citation 용 (PDF/PPT). null = N/A (text 등)
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,                              -- voyage-multilingual-2 dim
  bm25_tsv tsvector,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- { heading, section, char_start, char_end, ... } — citation/스니펫
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ephemeral_chunks_session_idx ON ephemeral_chunks(session_id);
CREATE INDEX ephemeral_chunks_upload_idx ON ephemeral_chunks(upload_id);
CREATE INDEX ephemeral_chunks_embedding_idx ON ephemeral_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX ephemeral_chunks_tsv_idx ON ephemeral_chunks USING gin(bm25_tsv);

ALTER TABLE ephemeral_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ephemeral_chunks_session_owner ON ephemeral_chunks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = ephemeral_chunks.session_id
      AND s.user_id = current_setting('app.user_id', true)::uuid
  ));
```

### `0015_project_team_scope_rls.sql`

```sql
-- L6 보완: projects 의 team scope RLS read/write 분리
-- ⚠️ org_unit_id 컬럼은 0004 에 이미 추가됨 (0005 의 RLS 가 본 컬럼을 참조하기 때문).
--    0015 는 RLS policy refine 만 담당. 컬럼 추가 ALTER 는 idempotent guard 로 보호.

-- 1) team scope FK 컬럼이 없으면 추가 (이전 plan 버전 migration 호환)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='projects' AND column_name='org_unit_id') THEN
    ALTER TABLE projects ADD COLUMN org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 인덱스는 0004 에서 이미 생성됨 (projects_org_unit_idx) — 중복 생성 회피.
CREATE INDEX IF NOT EXISTS projects_org_unit_idx ON projects(org_unit_id)
  WHERE org_unit_id IS NOT NULL;

-- visibility='team' 인데 org_unit_id 가 NULL 이면 의미 없음 → CHECK (0004 의 CHECK 와 중복 시 무시)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_team_requires_unit;
ALTER TABLE projects
  ADD CONSTRAINT projects_team_requires_unit
    CHECK (visibility <> 'team' OR org_unit_id IS NOT NULL);

-- 2) 기존 RLS policy 제거 (FOR ALL 단일) → 4 policy (SELECT/INSERT/UPDATE/DELETE) 로 분리

DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_modify_member ON projects;
DROP POLICY IF EXISTS projects_delete_owner ON projects;

-- SELECT: visibility 매트릭스 — org 누구나 / team 은 같은 org_unit / private 은 member 만
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND (
      visibility = 'org'
      OR (visibility = 'team' AND EXISTS (
        SELECT 1 FROM user_org_units uou
        WHERE uou.user_id = current_setting('app.user_id', true)::uuid
          AND uou.org_unit_id = projects.org_unit_id))
      OR EXISTS (SELECT 1 FROM project_members pm
                 WHERE pm.project_id = projects.id
                   AND pm.user_id = current_setting('app.user_id', true)::uuid)
    )
  );

-- INSERT: 새 project 만들기 — 본인 org 내 누구나 가능 (owner_id = self)
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (
    org_id = current_setting('app.org_id', true)::uuid
    AND owner_id = current_setting('app.user_id', true)::uuid
  );

-- UPDATE: member 중 owner/editor 만
CREATE POLICY projects_update_owner_editor ON projects
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role IN ('owner','editor')
  ));

-- DELETE: owner 만
CREATE POLICY projects_delete_owner ON projects
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role = 'owner'
  ));

-- 3) project_documents / document_chunks 도 FOR ALL → SELECT/INSERT/UPDATE/DELETE 분리
-- ⚠️ project_documents / document_chunks 는 0005 (Phase 4) 에서 생성됨.
--    0015 가 Phase 3 시점에 적용되면 이 두 테이블이 아직 없음.
--    해결: TO_REGCLASS guard — 테이블 존재 시에만 정책 변경, 아니면 NOTICE 후 skip.
--    Phase 4 의 0005 가 적용된 후 본 마이그레이션을 재실행하지 않아도, 0005 자체에 동등한 SELECT/INSERT/UPDATE/DELETE 분리 정책이 임베디드되어 있음 (0005 참조).
--    본 블록은 "0005 가 먼저 적용된 환경에서 0015 를 재실행" 케이스의 idempotency 를 위한 cleanup.

DO $$
BEGIN
  IF to_regclass('public.project_documents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS project_documents_via_project ON project_documents';
  END IF;
  IF to_regclass('public.document_chunks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS document_chunks_via_document ON document_chunks';
  END IF;
END $$;

-- 공통 visibility 검사 함수 (SECURITY DEFINER — RLS 재진입 방지)
CREATE OR REPLACE FUNCTION user_can_read_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.org_id = current_setting('app.org_id', true)::uuid
      AND (
        p.visibility = 'org'
        OR (p.visibility = 'team' AND EXISTS (
          SELECT 1 FROM user_org_units uou
          WHERE uou.user_id = current_setting('app.user_id', true)::uuid
            AND uou.org_unit_id = p.org_unit_id))
        OR EXISTS (SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id
                     AND pm.user_id = current_setting('app.user_id', true)::uuid)
      )
  );
$$;

CREATE OR REPLACE FUNCTION user_can_write_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = current_setting('app.user_id', true)::uuid
      AND pm.role IN ('owner','editor')
  );
$$;

REVOKE EXECUTE ON FUNCTION user_can_read_project(UUID)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_can_write_project(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_read_project(UUID)  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_write_project(UUID) TO PUBLIC;

-- project_documents / document_chunks 정책: 테이블 존재 시에만 생성 (Phase 3 시점엔 skip, Phase 4 0005 적용 후 재실행 또는 0005 자체에 동일 정책).
DO $$
BEGIN
  IF to_regclass('public.project_documents') IS NULL THEN
    RAISE NOTICE 'project_documents 미존재 — 0005 (Phase 4) 적용 전이라 정책 skip. 0005 본문에 동일 정책 임베디드.';
    RETURN;
  END IF;

  -- project_documents: SELECT 는 read 권한, INSERT/UPDATE/DELETE 는 write 권한
  EXECUTE 'CREATE POLICY pd_select ON project_documents FOR SELECT USING (user_can_read_project(project_id))';
  EXECUTE 'CREATE POLICY pd_insert ON project_documents FOR INSERT WITH CHECK (user_can_write_project(project_id))';
  EXECUTE 'CREATE POLICY pd_update ON project_documents FOR UPDATE USING (user_can_write_project(project_id)) WITH CHECK (user_can_write_project(project_id))';
  EXECUTE 'CREATE POLICY pd_delete ON project_documents FOR DELETE USING (user_can_write_project(project_id))';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'project_documents 정책 이미 존재 — 0005 가 먼저 임베디드 정책을 생성한 환경.';
END $$;

-- 아래의 raw CREATE POLICY 블록 (Phase 4 의 0005 본문에 동일 내용이 임베디드되어 있음) — 참고용으로 유지.
-- 실제 Phase 3 적용 시엔 위 DO $$ 블록만 실행됨.

-- document_chunks: 부모 document 의 권한 따름. 테이블 존재 시에만 생성.
DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RAISE NOTICE 'document_chunks 미존재 — 0005 적용 전. 정책 skip.';
    RETURN;
  END IF;
  EXECUTE $POL$
    CREATE POLICY dc_select ON document_chunks
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_read_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_insert ON document_chunks
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_update ON document_chunks
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
      WITH CHECK (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_delete ON document_chunks
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'document_chunks 정책 이미 존재.';
END $$;

-- 4) project_members: SELECT 는 같은 org 누구나 (member list 조회 가능), 변경은 owner 만
DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_modify_owner ON project_members;

CREATE POLICY pm_select ON project_members
  FOR SELECT
  USING (user_can_read_project(project_id));

CREATE POLICY pm_modify ON project_members
  FOR ALL
  USING (user_is_project_owner(project_id))     -- SECURITY DEFINER, 재귀 회피
  WITH CHECK (user_is_project_owner(project_id));
```

### `0016_indexes_vacuum.sql`

> **주의**: `CREATE INDEX CONCURRENTLY` 는 트랜잭션 안에서 실행 불가. drizzle-kit 의 기본 migration runner 가 각 마이그레이션을 트랜잭션으로 감싸므로, **본 마이그레이션은 별도 처리** 필요.
>
> `drizzle.config.ts` 에 `migrationsRunner: 'manual'` 옵션 사용 또는 본 마이그레이션을 일반 (비-CONCURRENTLY) 으로 두고 별도 ops 스크립트 (`scripts/post-deploy-indexes.sh`) 가 production 에서 수동 실행.

```sql
-- autovacuum tuning (트랜잭션 안에서 가능)
ALTER TABLE messages SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);
ALTER TABLE usage_logs SET (
  autovacuum_vacuum_scale_factor = 0.1
);
ALTER TABLE error_logs SET (
  autovacuum_vacuum_scale_factor = 0.1
);

-- partition (v1.1 검토): usage_logs / error_logs / tool_metrics 를 월 단위 partition
```

### `scripts/post-deploy-indexes.sh` (별도 — 트랜잭션 외 실행)

```bash
#!/usr/bin/env bash
# v1.0 GA 직전 또는 직후 운영 인덱스 (CONCURRENTLY) 추가.
# 각 명령은 별도 connection — 트랜잭션 밖에서 실행되어야 함.
set -euo pipefail
PSQL="psql ${DATABASE_URL}"

$PSQL -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS messages_session_role_idx ON messages(session_id, role, created_at DESC);"
$PSQL -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS usage_logs_created_idx ON usage_logs(created_at DESC);"
$PSQL -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS artifacts_storage_kind_idx ON artifacts(storage_kind);"
echo "✓ post-deploy indexes 적용 완료"
```

> **참고**: `0012_password_or_magic.sql` 의 `password_hash` 컬럼은 0001 본문에 없었기에 0012 에서 추가. v1.0 GA 시점의 user 인증 정책 → `12-OPS-SECURITY.md § 부록 A` (JWT) 참조.

## 부록 G · `apps/server/src/db/seed.ts` 본문

> **목적**: Phase 0 onboarding 과 smoke test 가 성립하려면 첫 마이그레이션 직후 다음이 DB 에 있어야 함.
> 1. 최소 1개 `organizations` (signup 의 `email 도메인 → org_id` 매칭이 동작)
> 2. 최소 1개 `org_units` (project visibility=team 지원)
> 3. (선택) smoke / admin 계정 — 로컬·CI smoke test 용
>
> 본 seed 는 **idempotent** — 다시 실행해도 중복 insert 안 됨 (`ON CONFLICT DO NOTHING`).
> **Phase 0 정책**: organizations / users 테이블이 0001 마이그레이션 적용 후에야 존재 → Phase 0 의 빈 schema 시점에 `db:seed` 호출하면 import 단계에서 fail. **본 seed.ts 는 첫 줄에서 `to_regclass('organizations') IS NULL` 검사 후 no-op 반환** (Phase 0 안전). Phase 1+ 0001 적용 후부터 실 seed.
> CI smoke job 은 Phase 1+ 부터 호출.

```typescript
// apps/server/src/db/seed.ts
import { db } from "./client";
import { organizations, orgUnits, users, userOrgUnits } from "./schema";
import { sql } from "drizzle-orm";
import { hashPassword } from "../auth/password";  // bcrypt wrapper

const ORG_DOMAIN = process.env.ORG_DOMAIN ?? "{{ORG_DOMAIN}}";
const ORG_NAME = process.env.ORG_NAME ?? "{{ORG_NAME}}";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD ?? "smoke-only-dev-pass-do-not-use-in-prod";

async function main() {
  console.warn(`seed: org=${ORG_NAME} domain=${ORG_DOMAIN}`);

  // Phase 0 safety: 0001 (organizations) 이 아직 적용 안 됐으면 시드 대상 테이블이 없음 → no-op.
  const hasOrgs = await db.execute(sql`SELECT to_regclass('public.organizations') AS t`);
  if (!(hasOrgs as unknown as { rows: Array<{ t: string | null }> }).rows?.[0]?.t) {
    console.warn("seed: organizations 테이블 없음 (Phase 0/migration 미적용) — skip.");
    return;
  }

  // 1) 기본 organization — email 도메인으로 매칭
  const [org] = await db.insert(organizations).values({
    name: ORG_NAME,
    domain: ORG_DOMAIN,
  }).onConflictDoNothing({ target: organizations.domain })
    .returning();

  const orgId = org?.id ?? (
    await db.select({ id: organizations.id })
      .from(organizations).where(sql`domain = ${ORG_DOMAIN}`)
  )[0].id;

  // 2) 기본 org_unit (visibility=team 의 default target)
  //    DDL: org_units.path_key TEXT NOT NULL UNIQUE(org_id, path_key). root 는 자기 name 그대로.
  const [unit] = await db.insert(orgUnits).values({
    orgId,
    name: "default",
    pathKey: "default",
    parentId: null,
  }).onConflictDoNothing({ target: [orgUnits.orgId, orgUnits.pathKey] })
    .returning();

  const unitId = unit?.id ?? (
    await db.select({ id: orgUnits.id })
      .from(orgUnits).where(sql`org_id = ${orgId} AND path_key = 'default'`)
  )[0].id;

  // 3) (dev only) smoke 계정 — admin 권한
  //    DDL: users.role CHECK IN ('member','admin','owner'), 'user' 는 위반.
  //    users 테이블에 emailVerifiedAt 컬럼 없음 (status='active' 가 활성 표시).
  //    SMOKE_EMAIL_LOCAL 환경변수로 smoke-test.sh 의 이메일과 sync (기본 'smoke-test').
  if (process.env.NODE_ENV !== "production") {
    const smokeLocal = process.env.SMOKE_EMAIL_LOCAL ?? "smoke-test";
    const smokeEmail = `${smokeLocal}@${ORG_DOMAIN}`;
    const adminEmail = `admin@${ORG_DOMAIN}`;
    const hash = await hashPassword(SMOKE_PASSWORD);

    for (const [email, role] of [[smokeEmail, "member"], [adminEmail, "admin"]] as const) {
      const [u] = await db.insert(users).values({
        email,
        orgId,
        role,
        passwordHash: hash,
        status: "active",
      }).onConflictDoNothing({ target: users.email })
        .returning();
      const userId = u?.id ?? (
        await db.select({ id: users.id }).from(users).where(sql`email = ${email}`)
      )[0].id;
      await db.insert(userOrgUnits).values({ userId, orgUnitId: unitId })
        .onConflictDoNothing();
    }
    console.log(`seed: dev accounts ${smokeEmail} / ${adminEmail} (password=$SMOKE_PASSWORD)`);
  }

  console.log("seed: done");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### 운영 환경 seed 정책

- `NODE_ENV=production` 일 때 smoke / admin 계정은 **생성 안 함** (위 if 블록 건너뜀).
- production 첫 admin 은 `scripts/bootstrap-admin.ts` (DB 직접 INSERT — `status='active'` set + password_hash) 로 별도 1회 실행. seed 와 분리해 prod 실수로 dev 비밀번호가 박히는 사고 차단.
- `ON CONFLICT DO NOTHING` — 재실행 가능. 마이그레이션 직후 자동 호출도 안전.

### 호출 시점

| 시점 | 명령 |
|---|---|
| 로컬 개발 첫 셋업 | `pnpm db:migrate && pnpm db:seed` |
| CI smoke test 전 | `pnpm db:migrate && pnpm db:seed` (NODE_ENV=test) |
| 운영 (prod) | `pnpm db:migrate` 만. seed 호출 안 함. admin 은 별도 부트스트랩 |



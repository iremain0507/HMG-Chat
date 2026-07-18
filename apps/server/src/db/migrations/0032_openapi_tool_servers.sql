-- 0032 · openapi_tool_servers (Phase 22 — 외부 OpenAPI 3.x 스펙을 호출 가능한 도구로 인제스트, P22-T1-12)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C13 (docs/rfc/P22-contract-batch.md § C13).
--   RFC 초안은 파일명을 0038_ 로 예시했으나, migration 번호는 _journal.json idx 와 연속이어야 하므로
--   실제로는 다음 순번인 0032 로 배치한다(승인 범위 MIGRATIONS_APPROVED: 0032~0039 안).
-- 단일 출처: apps/server/src/db/openapi-tool-server-data-access.ts(CRUD),
--   apps/server/src/tools/openapi-tool-adapter.ts(spec→AgentToolSpec 변환),
--   apps/server/src/routes/openapi-tool-servers.ts(REST).
-- 설계: mcp_servers(0009)의 미러 — 같은 org/project/user 스코프 모델, 같은 discovery 캐시
--   (supported_tools/last_discovered_at) 패턴, 같은 SSRF 방어(mcp/url-validator.ts)를 라우트에서 재사용.
-- nullable-first: 신규 테이블이라 기존 행 백필 없음. project_id/user_id 는 org 전역 등록을 위해 nullable,
--   auth_header_name/auth_secret_arn 은 인증 없는 공개 스펙을 위해 nullable,
--   last_discovered_at 은 등록 직후(아직 discover 전) 상태를 위해 nullable.
-- 롤백 경로: dev/staging 전용 — DROP TABLE openapi_tool_servers. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0031 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE openapi_tool_servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  spec_url TEXT NOT NULL,
  base_url TEXT NOT NULL,
  auth_header_name TEXT,
  auth_secret_arn TEXT,
  supported_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- discover 시점의 OpenApiOperation[] (method/path/parameters) — 호출 시 spec 재fetch 없이
  -- buildOpenApiRequest 로 실제 HTTP 요청을 조립하기 위해 supported_tools 와 함께 캐시한다.
  operations JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_discovered_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX openapi_tool_servers_org_created_idx
  ON openapi_tool_servers(org_id, created_at DESC);

ALTER TABLE openapi_tool_servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE openapi_tool_servers FORCE ROW LEVEL SECURITY;

CREATE POLICY openapi_tool_servers_isolation ON openapi_tool_servers
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

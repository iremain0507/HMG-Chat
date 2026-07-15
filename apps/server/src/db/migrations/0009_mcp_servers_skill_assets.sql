-- 0009 · mcp_servers + skill_assets (Phase 8 — Skills & MCP)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0009_mcp_servers_skills.sql
-- 컬럼 spec: 14-INTERFACES § McpServerRecord/SkillAssetRecord 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0008 과 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).

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
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (
      (project_id IS NULL AND user_id IS NULL)                                              -- org 전체 공유
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid                   -- user-scoped
      OR EXISTS (SELECT 1 FROM project_members pm                                           -- project-scoped
                 WHERE pm.project_id = mcp_servers.project_id
                   AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  );

CREATE POLICY mcp_servers_modify_admin ON mcp_servers
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (
      user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      OR current_user_is_admin()
    )
  );

CREATE POLICY skill_assets_read_anyone ON skill_assets
  FOR SELECT USING (TRUE);                       -- public 읽기 OK (실제 보안은 application level)
CREATE POLICY skill_assets_modify_admin ON skill_assets
  FOR ALL
  USING (current_user_is_admin());

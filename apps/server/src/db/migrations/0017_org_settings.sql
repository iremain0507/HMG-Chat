-- 0017 · org_settings (Phase 14 — Admin Settings)
-- 단일 출처: rebuild_plan/16-API-CONTRACT.md § admin/settings, apps/server/src/lib/org-settings-schema.ts(정본 검증/기본값)
-- 목적: 하드코딩된 LLM/시스템 설정(maxTokens 등)을 org 단위로 admin 이 설정 가능하게.
-- 롤백 경로: dev/staging 전용 — DROP TABLE org_settings (prod forward-only).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0016 과 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- NOTE: nullable-first — 기존 테이블에는 아무 변경도 가하지 않는다(신규 테이블만 추가). settings 는 DEFAULT '{}'::jsonb.

CREATE TABLE org_settings (
  org_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER org_settings_touch BEFORE UPDATE ON org_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY org_settings_select ON org_settings
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY org_settings_modify_admin ON org_settings
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

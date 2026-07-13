-- 0010 · user_quotas + usage_logs (Phase 9 — Quota & Observability)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0010_quotas_usage.sql
-- 컬럼 spec: 14-INTERFACES § UserQuotaInfo/UsageLogEntry 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0009 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).

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
  FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
CREATE POLICY user_quotas_admin_modify ON user_quotas
  FOR ALL
  USING (current_user_is_admin());

CREATE POLICY usage_logs_owner_or_admin ON usage_logs
  FOR SELECT
  USING (
    user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (current_user_is_admin()
        AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  );

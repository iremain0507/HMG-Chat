-- 0011 · error_logs + tool_metrics + health_check_history + alert_events (Phase 9 — Quota & Observability)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0011_observability.sql
-- 컬럼 spec: 14-INTERFACES § ErrorLogEntry/ToolMetricEntry/HealthCheckResult/AlertEvent 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 네 테이블 DROP.

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

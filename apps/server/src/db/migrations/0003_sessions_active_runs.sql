-- 0003 · sessions_active_runs
-- 적용 시점: Phase 2
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 부록 F (본문 그대로)
-- 롤백 경로: dev/staging 전용 — DROP TABLE sessions_active_runs;
--            prod 는 forward-only 정책 (신규 테이블이라 안전, nullable-first 고려 대상 컬럼 없음).

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

-- NOTE: current_setting(...)::uuid 대신 NULLIF(..., '')::uuid 사용 — 0002_sessions_messages.sql 과
-- 동일 사유 (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
CREATE POLICY active_runs_via_session ON sessions_active_runs
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = sessions_active_runs.session_id
      AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

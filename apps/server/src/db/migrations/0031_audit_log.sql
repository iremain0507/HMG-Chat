-- 0031 · audit_log (Phase 20 — 관리 변경/인증 이벤트 감사 로그, 엔터프라이즈 필수, P20-T1-16)
-- 단일 출처: apps/server/src/db/audit-log-data-access.ts(기록/조회),
--   apps/server/src/lib/audit-recorder.ts(fail-soft 기록 래퍼 — 21-LOOP-LESSONS L5,
--   감사 기록 실패가 admin mutation 자체를 막아선 안 됨), apps/server/src/routes/admin-audit.ts(조회).
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님). actor_user_id 는
--   시스템/미인증 이벤트(예: 실패한 로그인 시도)를 남길 수 있도록 nullable, resource_type/
--   resource_id 도 리소스가 없는 이벤트(예: 설정 전체 변경)를 위해 nullable.
-- 롤백 경로: dev/staging 전용 — DROP TABLE audit_log. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0030 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: resource_grants(0027)·conversation_shares(0030)와 동일하게 org_id 를 직접 들고
--   RLS 방어선을 만든다. 조회는 admin 전용(감사 로그 자체가 민감정보), 기록(INSERT)은
--   application 서비스 role 이 요청자의 org_id 로만 삽입 가능하도록 WITH CHECK 로 제한한다.
--   actor_user_id 는 users FK 를 걸되 ON DELETE SET NULL(사용자가 삭제돼도 감사 이력은 보존).

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_log_org_created_idx ON audit_log(org_id, created_at DESC);
CREATE INDEX audit_log_org_action_idx ON audit_log(org_id, action);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_log_select ON audit_log
  FOR SELECT
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

CREATE POLICY audit_log_insert ON audit_log
  FOR INSERT
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- 0007 · artifact_shares (Phase 6 에서 활성화 — ArtifactShareRepo/routes/public-share.ts 의존)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0007_artifact_shares.sql
-- 컬럼 spec: 14-INTERFACES § ArtifactShareRecord 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 테이블 DROP + DROP FUNCTION artifact_owner_org_id(UUID).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0006/0012~0015 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- NOTE: 06-DATA-MODEL.md 본문은 issuer-only RLS 를 보였으나 lint-plan.sh § 96 이 same-org admin
--       branch 를 요구(admin 이 share 를 관리 못 하면 revoke 운영이 불가) — 0001 의 current_user_is_admin()
--       SECURITY DEFINER 함수로 재귀 없이 admin 여부 판정.

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
-- public /share/<token> 호출은 별도 service-role connection (RLS 우회) 사용 — Phase 6 범위.
-- admin branch 의 org boundary 는 artifacts.created_by → users.org_id join 으로 강제
-- (admin 이 다른 org 의 share 를 못 봄).
--
-- NOTE(deviation, RLS 재귀/가시성 회피): admin branch 를 raw EXISTS(artifacts JOIN users) 서브쿼리로
-- 두면 그 서브쿼리 자체가 artifacts_owner_or_session RLS(0006, created_by=본인 또는 session 소유자만
-- 허용) 대상이라, 발급자 본인이 아닌 admin 에게는 artifacts 행 자체가 안 보여 EXISTS 가 항상 false —
-- admin 이 영원히 share 를 못 보는 버그(rls-artifact-shares.test.ts "같은-org admin" 케이스로 재현).
-- 0004 의 project_org_id() 와 동일한 패턴으로 SECURITY DEFINER 함수를 통해 artifacts/users RLS 를
-- 우회한 org_id 조회로 대체.
CREATE OR REPLACE FUNCTION artifact_owner_org_id(p_artifact_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT owner.org_id
  FROM artifacts a
  JOIN users owner ON owner.id = a.created_by
  WHERE a.id = p_artifact_id;
$$;
REVOKE EXECUTE ON FUNCTION artifact_owner_org_id(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION artifact_owner_org_id(UUID) TO PUBLIC;

ALTER TABLE artifact_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifact_shares_issuer_or_admin ON artifact_shares
  FOR ALL
  USING (
    issued_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (
      current_user_is_admin()
      AND artifact_owner_org_id(artifact_shares.artifact_id)
            = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
  );

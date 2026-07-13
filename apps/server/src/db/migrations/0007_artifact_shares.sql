-- 0007 · artifact_shares (Phase 6 에서 활성화 — ArtifactShareRepo/routes/public-share.ts 의존)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0007_artifact_shares.sql
-- 컬럼 spec: 14-INTERFACES § ArtifactShareRecord 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 테이블 DROP.
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
ALTER TABLE artifact_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifact_shares_issuer_or_admin ON artifact_shares
  FOR ALL
  USING (
    issued_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (
      current_user_is_admin()
      AND EXISTS (
        SELECT 1 FROM artifacts a
        JOIN users owner ON owner.id = a.created_by
        WHERE a.id = artifact_shares.artifact_id
          AND owner.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
      )
    )
  );

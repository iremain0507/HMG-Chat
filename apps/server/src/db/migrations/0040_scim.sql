-- 0040 · SCIM 2.0 프로비저닝 (P22-T1-16)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C15 (엔터프라이즈 단위의 후속 migration 0040+ 승인).
-- 단일 출처: apps/server/src/routes/scim.ts (/scim/v2/Users, /Groups),
--   apps/server/src/db/scim-data-access.ts (pg 구현).
-- 설계: SCIM 리소스를 위한 신규 리소스 테이블은 만들지 않는다 — User 는 users,
--   Group 은 groups/group_members(0026) 에 그대로 매핑하고, 여기서는
--   (a) IdP 가 보내는 externalId 를 붙잡을 컬럼과 (b) IdP 전용 Bearer 토큰만 추가한다.
--   그래서 SCIM 으로 만든 사용자/그룹이 admin UI·RBAC·grant 와 자동으로 같은 것이 된다.
-- nullable-first: external_id 는 NULL 허용 — 기존 users/groups 행은 전부 무변경으로 동작하고
--   백필도 필요 없다(NULL = SCIM 이 아닌 경로로 만들어진 로컬 계정/그룹).
--   UNIQUE 는 partial index(WHERE external_id IS NOT NULL)라 NULL 다수 행과 공존한다.
-- 비활성(deprovision)은 별도 컬럼 없이 기존 users.status='suspended' 를 재사용한다
--   (0001_identity CHECK 제약 안의 값 — 스키마 변경 없음).
-- 롤백 경로: dev/staging 전용 —
--   DROP TABLE scim_tokens;
--   DROP INDEX users_org_external_id_uidx; ALTER TABLE users DROP COLUMN external_id;
--   DROP INDEX groups_org_external_id_uidx; ALTER TABLE groups DROP COLUMN external_id;
--   (prod 는 forward-only 정책.)

ALTER TABLE users  ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS external_id TEXT;

-- externalId 는 IdP 테넌트(=org) 안에서만 유일하다. org 를 포함해야 다른 org 의 IdP 가
-- 같은 externalId 를 써도 충돌하지 않는다.
CREATE UNIQUE INDEX users_org_external_id_uidx
  ON users(org_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX groups_org_external_id_uidx
  ON groups(org_id, external_id) WHERE external_id IS NOT NULL;

-- IdP 전용 Bearer 토큰. api_keys(0025) 와 같은 원칙 — 원문은 저장하지 않고 sha256 hex 만
-- 보관하며(db/scim-data-access.ts hashScimToken), 토큰 하나가 곧 org 하나를 결정한다.
-- 그래서 /scim/v2 는 요청 body/path 에서 org 를 받지 않아도 되고, cross-org 가 구조적으로 불가.
CREATE TABLE scim_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX scim_tokens_org_idx ON scim_tokens(org_id);

ALTER TABLE scim_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_tokens FORCE ROW LEVEL SECURITY;

-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid — 0001~0039 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 토큰 자체의 관리(발급/폐기)는 admin 전용이고, SCIM 요청 경로는 authMiddleware 밖에서
-- token_hash 로 직접 조회하므로 조회 정책은 org 범위로 둔다(api_keys 와 동일 형태).
CREATE POLICY scim_tokens_select ON scim_tokens
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY scim_tokens_modify ON scim_tokens
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

-- 0027 · resource_grants (Phase 19 — Admin RBAC 리소스 접근제어, Open WebUI 참고 gap Admin)
-- 단일 출처: apps/server/src/lib/access-control.ts (canAccessResource, additive union),
--   apps/server/src/db/resource-grants-data-access.ts (grant 저장/조회)
-- 롤백 경로: dev/staging 전용 — DROP TABLE resource_grants. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0026 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: groups(0026)와 동일하게 org_id 를 직접 들고 RLS 방어선을 만든다(join 없이 즉시
--   cross-org 차단). subject_id 는 subject_type 에 따라 users.id 또는 groups.id 를 가리키지만
--   다형이라 FK 를 걸지 않는다(application 레벨에서 grant 시점에 존재 검증). 수정(부여/회수)은
--   admin 전용 — current_user_is_admin() 추가 조건. 접근 판정은 "additive union": 리소스에 대해
--   direct user grant 또는 사용자가 속한 어느 group 의 grant 든 하나라도 access 를 만족하면 허용.

CREATE TABLE resource_grants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('model', 'knowledge', 'tool', 'prompt')),
  resource_id TEXT NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('user', 'group')),
  subject_id UUID NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('read', 'write')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, resource_type, resource_id, subject_type, subject_id, access)
);
CREATE INDEX resource_grants_org_idx ON resource_grants(org_id);
CREATE INDEX resource_grants_resource_idx ON resource_grants(org_id, resource_type, resource_id);
CREATE INDEX resource_grants_subject_idx ON resource_grants(org_id, subject_type, subject_id);

ALTER TABLE resource_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_grants FORCE ROW LEVEL SECURITY;

CREATE POLICY resource_grants_select ON resource_grants
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY resource_grants_modify ON resource_grants
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

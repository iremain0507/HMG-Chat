-- 0026 · groups + group_members (Phase 19 — Admin RBAC 그룹, Open WebUI 참고 gap Admin)
-- 단일 출처: apps/server/src/routes/admin-groups.ts (CRUD /api/v1/admin/groups, 멤버 추가/제거)
-- 롤백 경로: dev/staging 전용 — DROP TABLE group_members, groups. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0025 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: group_members 는 session_tags(0020)/session_folders(0019) 와 동일하게 org_id 를
--   직접 들고 RLS 방어선을 만든다(groups 로 join 하지 않고 즉시 cross-org 차단). 수정(그룹
--   생성/이름변경/삭제/멤버 추가·제거)은 admin 전용 — current_user_is_admin() 추가 조건.
--   (dev/test DATABASE_URL role 은 superuser 라 RLS 를 우회하므로, application 레벨
--   db/group-data-access.ts 에서도 org_id WHERE 를 명시적으로 강제하는 이중 방어 패턴.)

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX groups_org_idx ON groups(org_id);
CREATE TRIGGER groups_touch BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX group_members_user_idx ON group_members(user_id);
CREATE INDEX group_members_org_idx ON group_members(org_id);

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members FORCE ROW LEVEL SECURITY;

CREATE POLICY groups_select ON groups
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY groups_modify ON groups
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

CREATE POLICY group_members_select ON group_members
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY group_members_modify ON group_members
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND current_user_is_admin()
  );

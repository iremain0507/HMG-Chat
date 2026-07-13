-- 0004 · projects + project_members
-- 적용 시점: Phase 3
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 부록 F (본문 그대로)
-- 롤백 경로: dev/staging 전용 —
--   ALTER TABLE sessions DROP CONSTRAINT sessions_project_fk;
--   DROP FUNCTION bootstrap_project_owner(UUID, UUID);
--   DROP TABLE project_members; DROP TABLE projects;
--   prod 는 forward-only 정책 (신규 테이블이라 안전, nullable-first 고려 대상 컬럼 없음).
--
-- NOTE: current_setting(...)::uuid 대신 NULLIF(..., '')::uuid 사용 — 0001/0002/0003 과
-- 동일 사유 (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- user_role_in_project/user_is_project_owner 는 0001 에서 이미 (forward-reference) stub 으로 정의됨 —
-- project_members 테이블이 이제 생겼으므로 별도 재정의 없이 그대로 동작.
--
-- NOTE(deviation): 06-DATA-MODEL.md 원문의 project_members_select 는 projects 테이블을 직접
-- 서브쿼리하는데, projects_select 가 반대로 project_members 를 서브쿼리하는 것과 맞물려
-- 실 Postgres 에서 "infinite recursion detected in policy for relation projects" 발생 확인
-- (rls-projects.test.ts 로 재현). project_org_id() SECURITY DEFINER 함수로 projects 조회를
-- 우회해 상호 재귀를 끊음 — user_is_project_owner 와 동일한 재귀 회피 패턴.

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('private','team','org')),
  -- org_unit_id: visibility='team' 일 때만 의미. 0015 의 RLS 가 본 컬럼 참조 → 0004 에 미리 추가.
  -- 0015 는 RLS read/write 분리 정책만 담당 (컬럼은 본 마이그레이션에서 도입).
  org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT projects_team_orgunit_required
    CHECK (visibility <> 'team' OR org_unit_id IS NOT NULL)
);
CREATE INDEX projects_org_unit_idx ON projects(org_unit_id) WHERE org_unit_id IS NOT NULL;
CREATE INDEX projects_org_visibility_idx ON projects(org_id, visibility);
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- sessions.project_id 의 FK 연결 (0002 에서 컬럼만 만든 상태)
ALTER TABLE sessions ADD CONSTRAINT sessions_project_fk
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;

ALTER TABLE projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- projects: visibility 매트릭스 (08-SPRINT-PLAN.md § Phase 3 visibility 매트릭스)
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (
      visibility IN ('org','team')                                 -- org 내 누구나
      OR EXISTS (                                                  -- 또는 멤버
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      )
    )
  );

-- INSERT: 0004 에 미리 정의 — Phase 3 POST /projects 가 0015 적용 전에도 동작.
-- 0015 가 본 policy 를 DROP + 재정의 (org_unit 검증 추가) 하지만 0004 만으로도 RLS 통과 안전.
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

CREATE POLICY projects_modify_member ON projects
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role IN ('owner','editor')
  ));

CREATE POLICY projects_delete_owner ON projects
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role = 'owner'
  ));

-- project_org_id: project_members_select 가 projects 를 직접 서브쿼리하면 projects_select
-- (project_members 를 서브쿼리) 와 맞물려 상호 RLS 재귀가 발생 — SECURITY DEFINER 로 우회.
CREATE OR REPLACE FUNCTION project_org_id(p_project_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT org_id FROM projects WHERE id = p_project_id;
$$;
REVOKE EXECUTE ON FUNCTION project_org_id(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION project_org_id(UUID) TO PUBLIC;

CREATE POLICY project_members_select ON project_members
  FOR SELECT
  USING (
    project_org_id(project_id) = NULLIF(current_setting('app.org_id', true), '')::uuid
  );

CREATE POLICY project_members_modify_owner ON project_members
  FOR ALL
  USING (user_is_project_owner(project_id))     -- SECURITY DEFINER, 재귀 회피
  WITH CHECK (user_is_project_owner(project_id));

-- 최초 owner row bootstrap — 위 pm_modify 정책이 self-referential 이라
-- POST /projects 의 첫 row 가 deny 됨. SECURITY DEFINER 함수로 정책 우회.
-- server 의 createProjectWithOwner() 가 본 함수만 호출 — 다른 경로로는 호출 금지.
CREATE OR REPLACE FUNCTION bootstrap_project_owner(p_project_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- 함수 호출자가 새 project 의 actual creator 인지 검증 (다른 user 가 자기 user_id 로 호출 차단)
  IF p_user_id <> NULLIF(current_setting('app.user_id', true), '')::uuid THEN
    RAISE EXCEPTION 'bootstrap_project_owner: user_id mismatch with app.user_id';
  END IF;
  -- 해당 project 가 이미 owner 가 있으면 거부 (중복 호출 방지)
  IF EXISTS (SELECT 1 FROM project_members
             WHERE project_id = p_project_id AND role = 'owner') THEN
    RAISE EXCEPTION 'bootstrap_project_owner: project % already has owner', p_project_id;
  END IF;
  INSERT INTO project_members (project_id, user_id, role)
    VALUES (p_project_id, p_user_id, 'owner');
END;
$$;
REVOKE EXECUTE ON FUNCTION bootstrap_project_owner(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION bootstrap_project_owner(UUID, UUID) TO PUBLIC;
-- 보안: SECURITY DEFINER 라도 위 두 check (user_id match + no existing owner) 가 권한 우회 방지.

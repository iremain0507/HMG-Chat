-- 0015 · projects team scope RLS 분리
-- 적용 시점: Phase 3 (0004 직후)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0015_project_team_scope_rls.sql
-- 롤백 경로: dev/staging 전용 —
--   0004 의 원래 정책(projects_select/projects_modify_member/projects_delete_owner FOR ALL 형태)으로
--   되돌리려면 본 마이그레이션이 만든 policy 를 DROP 하고 0004 본문의 CREATE POLICY 를 재실행.
--   prod 는 forward-only 정책.
--
-- NOTE: org_unit_id 컬럼/CHECK 제약은 0004 에 이미 추가됨(0015 가 참조하기 때문에 0004 가 선반영).
--       본 마이그레이션은 RLS policy refine 만 담당 — 컬럼 추가 블록은 이전 plan 버전 호환용 idempotent guard.
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0004 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- NOTE(deviation): 06-DATA-MODEL.md 원문은 projects_insert 를 DROP 없이 재 CREATE 하는데, 0004 가 이미
--   동일 이름의 policy 를 만들어놔서 그대로 실행하면 "policy already exists" 로 실패한다
--   (0004 의 주석 "0015 가 본 policy 를 DROP + 재정의" 가 이 의도를 이미 명시). DROP POLICY IF EXISTS
--   projects_insert 를 추가해 실제로 재정의되게 한다 (본문은 0004 와 동일 — 재확인 목적).

-- 1) team scope FK 컬럼이 없으면 추가 (이전 plan 버전 migration 호환)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name='projects' AND column_name='org_unit_id') THEN
    ALTER TABLE projects ADD COLUMN org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 인덱스는 0004 에서 이미 생성됨 (projects_org_unit_idx) — 중복 생성 회피.
CREATE INDEX IF NOT EXISTS projects_org_unit_idx ON projects(org_unit_id)
  WHERE org_unit_id IS NOT NULL;

-- visibility='team' 인데 org_unit_id 가 NULL 이면 의미 없음 → CHECK (0004 의 CHECK 와 중복 시 무시)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_team_requires_unit;
ALTER TABLE projects
  ADD CONSTRAINT projects_team_requires_unit
    CHECK (visibility <> 'team' OR org_unit_id IS NOT NULL);

-- 2) 기존 RLS policy 제거 (FOR ALL 단일) → 4 policy (SELECT/INSERT/UPDATE/DELETE) 로 분리

DROP POLICY IF EXISTS projects_select ON projects;
DROP POLICY IF EXISTS projects_insert ON projects;
DROP POLICY IF EXISTS projects_modify_member ON projects;
DROP POLICY IF EXISTS projects_delete_owner ON projects;

-- SELECT: visibility 매트릭스 — org 누구나 / team 은 같은 org_unit / private 은 member 만
CREATE POLICY projects_select ON projects
  FOR SELECT
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND (
      visibility = 'org'
      OR (visibility = 'team' AND EXISTS (
        SELECT 1 FROM user_org_units uou
        WHERE uou.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
          AND uou.org_unit_id = projects.org_unit_id))
      OR EXISTS (SELECT 1 FROM project_members pm
                 WHERE pm.project_id = projects.id
                   AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    )
  );

-- INSERT: 새 project 만들기 — 본인 org 내 누구나 가능 (owner_id = self)
CREATE POLICY projects_insert ON projects
  FOR INSERT
  WITH CHECK (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

-- UPDATE: member 중 owner/editor 만
CREATE POLICY projects_update_owner_editor ON projects
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role IN ('owner','editor')
  ));

-- DELETE: owner 만
CREATE POLICY projects_delete_owner ON projects
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = projects.id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role = 'owner'
  ));

-- 3) project_documents / document_chunks 도 FOR ALL → SELECT/INSERT/UPDATE/DELETE 분리
-- ⚠️ project_documents / document_chunks 는 0005 (Phase 4) 에서 생성됨.
--    0015 가 Phase 3 시점에 적용되면 이 두 테이블이 아직 없음.
--    해결: TO_REGCLASS guard — 테이블 존재 시에만 정책 변경, 아니면 NOTICE 후 skip.
--    Phase 4 의 0005 가 적용된 후 본 마이그레이션을 재실행하지 않아도, 0005 자체에 동등한 SELECT/INSERT/UPDATE/DELETE 분리 정책이 임베디드되어 있음 (0005 참조).
--    본 블록은 "0005 가 먼저 적용된 환경에서 0015 를 재실행" 케이스의 idempotency 를 위한 cleanup.

DO $$
BEGIN
  IF to_regclass('public.project_documents') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS project_documents_via_project ON project_documents';
  END IF;
  IF to_regclass('public.document_chunks') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS document_chunks_via_document ON document_chunks';
  END IF;
END $$;

-- 공통 visibility 검사 함수 (SECURITY DEFINER — RLS 재진입 방지)
CREATE OR REPLACE FUNCTION user_can_read_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
      AND (
        p.visibility = 'org'
        OR (p.visibility = 'team' AND EXISTS (
          SELECT 1 FROM user_org_units uou
          WHERE uou.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND uou.org_unit_id = p.org_unit_id))
        OR EXISTS (SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id
                     AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
      )
  );
$$;

CREATE OR REPLACE FUNCTION user_can_write_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role IN ('owner','editor')
  );
$$;

REVOKE EXECUTE ON FUNCTION user_can_read_project(UUID)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_can_write_project(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_read_project(UUID)  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_write_project(UUID) TO PUBLIC;

-- project_documents / document_chunks 정책: 테이블 존재 시에만 생성 (Phase 3 시점엔 skip, Phase 4 0005 적용 후 재실행 또는 0005 자체에 동일 정책).
DO $$
BEGIN
  IF to_regclass('public.project_documents') IS NULL THEN
    RAISE NOTICE 'project_documents 미존재 — 0005 (Phase 4) 적용 전이라 정책 skip. 0005 본문에 동일 정책 임베디드.';
    RETURN;
  END IF;

  EXECUTE 'CREATE POLICY pd_select ON project_documents FOR SELECT USING (user_can_read_project(project_id))';
  EXECUTE 'CREATE POLICY pd_insert ON project_documents FOR INSERT WITH CHECK (user_can_write_project(project_id))';
  EXECUTE 'CREATE POLICY pd_update ON project_documents FOR UPDATE USING (user_can_write_project(project_id)) WITH CHECK (user_can_write_project(project_id))';
  EXECUTE 'CREATE POLICY pd_delete ON project_documents FOR DELETE USING (user_can_write_project(project_id))';
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'project_documents 정책 이미 존재 — 0005 가 먼저 임베디드 정책을 생성한 환경.';
END $$;

-- document_chunks: 부모 document 의 권한 따름. 테이블 존재 시에만 생성.
DO $$
BEGIN
  IF to_regclass('public.document_chunks') IS NULL THEN
    RAISE NOTICE 'document_chunks 미존재 — 0005 적용 전. 정책 skip.';
    RETURN;
  END IF;
  EXECUTE $POL$
    CREATE POLICY dc_select ON document_chunks
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_read_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_insert ON document_chunks
      FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_update ON document_chunks
      FOR UPDATE USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
      WITH CHECK (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
  EXECUTE $POL$
    CREATE POLICY dc_delete ON document_chunks
      FOR DELETE USING (
        EXISTS (SELECT 1 FROM project_documents pd
                WHERE pd.id = document_chunks.document_id
                  AND user_can_write_project(pd.project_id)))
  $POL$;
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'document_chunks 정책 이미 존재.';
END $$;

-- 4) project_members: SELECT 는 프로젝트를 읽을 수 있는 사람 누구나 (member list 조회 가능), 변경은 owner 만
DROP POLICY IF EXISTS project_members_select ON project_members;
DROP POLICY IF EXISTS project_members_modify_owner ON project_members;

CREATE POLICY pm_select ON project_members
  FOR SELECT
  USING (user_can_read_project(project_id));

CREATE POLICY pm_modify ON project_members
  FOR ALL
  USING (user_is_project_owner(project_id))     -- SECURITY DEFINER, 재귀 회피
  WITH CHECK (user_is_project_owner(project_id));

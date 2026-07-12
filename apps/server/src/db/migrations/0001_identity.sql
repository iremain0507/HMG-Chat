-- 0001 · Identity & RLS skeleton
-- 적용 시점: Phase 1 시작 직후
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 부록 A (본문 그대로)
-- 롤백 경로: rebuild_plan/06-DATA-MODEL.md § 부록 A "Down (rollback)" — dev/staging 전용, prod 는 forward-only 정책.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ─── organizations ───
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  domain TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'standard',
  allowed_models JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_token_budget_micros BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX organizations_domain_idx ON organizations(domain);

-- ─── org_units (트리) ───
CREATE TABLE org_units (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  path_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_units_path_unique UNIQUE (org_id, path_key)
);

CREATE INDEX org_units_org_idx ON org_units(org_id);
CREATE INDEX org_units_parent_idx ON org_units(parent_id);

-- ─── users ───
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin','owner')),
  custom_instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX users_org_idx ON users(org_id);

-- ─── user_org_units (M:N) ───
CREATE TABLE user_org_units (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_unit_id UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  membership_role TEXT NOT NULL DEFAULT 'member'
    CHECK (membership_role IN ('member','lead','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, org_unit_id)
);

CREATE INDEX user_org_units_unit_idx ON user_org_units(org_unit_id);

-- ─── RLS 활성화 + FORCE (table owner 도 우회 못 함) ───
-- ENABLE 만 하면 BYPASSRLS 권한이나 table owner 는 우회 가능. FORCE 까지 추가해야 마스터/migrator/owner 도 policy 통과 의무.
-- 정책: master/migrator credential 은 ALTER/CREATE/DROP 용 — 일상 query 에 사용 금지.
-- 일상 query 는 app_user (BYPASSRLS 없음, owner 아님) 로 수행 → RLS 강제.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE  ROW LEVEL SECURITY;
ALTER TABLE org_units     ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_units     FORCE  ROW LEVEL SECURITY;
ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE users         FORCE  ROW LEVEL SECURITY;
ALTER TABLE user_org_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_org_units FORCE  ROW LEVEL SECURITY;

-- ─── RLS helper function (자기참조 재귀 회피용) ───
-- RLS policy 안에서 `EXISTS (SELECT FROM users ...)` 를 직접 쓰면 같은 테이블의
-- RLS policy 가 재진입 → 무한 재귀. SECURITY DEFINER function 으로 RLS 우회 조회.
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT role FROM users WHERE id = current_setting('app.user_id', true)::uuid;
$$;

CREATE OR REPLACE FUNCTION current_user_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT current_user_role() IN ('admin','owner');
$$;

-- project_members 자기참조 회피 (0004/0015 의 pm_modify 등에서 사용)
-- ⚠️ Forward reference: project_members 는 0004 에서 생성됨.
--    PostgreSQL `LANGUAGE sql` 은 정의 시점에 referenced object resolve 를 시도하므로
--    0001 에선 **stub** 으로 정의 (NULL 반환), 0004 가 `CREATE OR REPLACE` 로 본문 교체.
--    LANGUAGE plpgsql 은 동적 lookup → forward reference OK. 본 함수도 plpgsql 로 두면 더 단순.
CREATE OR REPLACE FUNCTION user_role_in_project(p_project_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- 0004 이전엔 project_members 가 없어 NULL 반환 — RLS 결과는 어떤 policy 도 통과 안 됨.
  -- 0004 적용 후 본 EXECUTE 가 실제 role 을 반환.
  BEGIN
    EXECUTE 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = current_setting(''app.user_id'', true)::uuid'
      INTO v_role USING p_project_id;
  EXCEPTION
    WHEN undefined_table THEN
      v_role := NULL;  -- 0001~0003 시점 fallback
  END;
  RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION user_is_project_owner(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT user_role_in_project(p_project_id) = 'owner';
$$;

CREATE OR REPLACE FUNCTION user_is_project_editor_or_owner(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT user_role_in_project(p_project_id) IN ('owner','editor');
$$;

REVOKE EXECUTE ON FUNCTION current_user_role()                      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION current_user_is_admin()                  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_role_in_project(UUID)               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_is_project_owner(UUID)              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_is_project_editor_or_owner(UUID)    FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION current_user_role()                      TO PUBLIC;
GRANT  EXECUTE ON FUNCTION current_user_is_admin()                  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_role_in_project(UUID)               TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_is_project_owner(UUID)              TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_is_project_editor_or_owner(UUID)    TO PUBLIC;

-- ─── RLS policy ───
-- 모든 정책은 미들웨어가 SET LOCAL 한 두 값을 참조:
--   SET LOCAL app.user_id = '<uuid>';
--   SET LOCAL app.org_id  = '<uuid>';
-- 미들웨어는 매 요청을 BEGIN/COMMIT 트랜잭션으로 감싸 SET LOCAL 의 범위를 보장.

CREATE POLICY organizations_select ON organizations
  FOR SELECT
  USING (id = current_setting('app.org_id', true)::uuid);

CREATE POLICY organizations_modify_admin ON organizations
  FOR ALL
  USING (
    id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()                 -- SECURITY DEFINER 함수, RLS 우회
  );

CREATE POLICY org_units_select ON org_units
  FOR SELECT
  USING (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY org_units_modify ON org_units
  FOR ALL
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()
  );

CREATE POLICY users_select_same_org ON users
  FOR SELECT
  USING (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY users_update_self ON users
  FOR UPDATE
  USING (id = current_setting('app.user_id', true)::uuid);

CREATE POLICY users_admin_modify ON users
  FOR ALL
  USING (
    org_id = current_setting('app.org_id', true)::uuid
    AND current_user_is_admin()                 -- 같은 테이블 자기참조 회피
  );

CREATE POLICY user_org_units_select ON user_org_units
  FOR SELECT
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR EXISTS (
      SELECT 1 FROM org_units ou
      WHERE ou.id = user_org_units.org_unit_id
        AND ou.org_id = current_setting('app.org_id', true)::uuid
    )
  );

-- ─── trigger: updated_at 자동 갱신 ───
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER org_units_touch BEFORE UPDATE ON org_units
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

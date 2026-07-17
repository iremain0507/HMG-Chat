-- 0024 · prompts (Phase 19 — 프롬프트 라이브러리, Open WebUI 참고 gap Ⓓ)
-- 단일 출처: apps/server/src/routes/prompts.ts (CRUD /api/v1/prompts)
-- 롤백 경로: dev/staging 전용 — DROP TABLE prompts. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0023 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 접근 모델: access='private' 는 owner_id 본인만, access='org' 는 같은 org 전원 조회 가능.
--   dev/test DATABASE_URL role 은 superuser 라 RLS 를 우회하므로, private/org 구분은
--   application 레벨(routes/prompts.ts + db/prompt-data-access.ts)에서 강제하고, RLS 는
--   session_folders(0019)/message_feedback(0023) 와 동일하게 org 단위 방어선만 담당한다.
-- command 는 '/' 로 시작하는 슬래시 명령 식별자(예: '/summary') — org 내 UNIQUE.

CREATE TABLE prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  access TEXT NOT NULL DEFAULT 'private' CHECK (access IN ('private', 'org')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, command)
);
CREATE INDEX prompts_org_idx ON prompts(org_id);
CREATE INDEX prompts_owner_idx ON prompts(owner_id);
CREATE TRIGGER prompts_touch BEFORE UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts FORCE ROW LEVEL SECURITY;

CREATE POLICY prompts_select ON prompts
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY prompts_modify ON prompts
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

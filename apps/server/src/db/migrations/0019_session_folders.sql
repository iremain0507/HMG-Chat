-- 0019 · session_folders (Phase 19 — 세션 폴더 정리, Open WebUI 참고 gap Ⓑ)
-- 단일 출처: apps/server/src/routes/folders.ts, apps/server/src/routes/sessions.ts(folder_id 할당)
-- 롤백 경로: dev/staging 전용 — ALTER TABLE sessions DROP COLUMN folder_id; DROP TABLE session_folders.
--            prod 는 forward-only 정책.
-- nullable-first: sessions.folder_id 는 신규 nullable 컬럼(DEFAULT 없음) — 기존 row 는 전부
--   folder_id IS NULL(미분류)로 시작, 기존 조회/정렬 동작 무변경.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0018 과 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- 소유 모델: 폴더는 개인 소유(sessions 와 동일하게 본인 것만 조회/수정 — Open WebUI 폴더도 org 공유가
--   아닌 per-user 트리). org_id 는 cross-org 방어선(dev/test DB role 은 RLS 를 우회하는 superuser 라
--   application 레벨(routes/folders.ts)에서도 org_id+created_by 이중 검사).

CREATE TABLE session_folders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX session_folders_owner_idx ON session_folders(org_id, created_by);
CREATE TRIGGER session_folders_touch BEFORE UPDATE ON session_folders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE sessions ADD COLUMN folder_id UUID REFERENCES session_folders(id) ON DELETE SET NULL;
CREATE INDEX sessions_folder_idx ON sessions(folder_id) WHERE folder_id IS NOT NULL;

ALTER TABLE session_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_folders FORCE ROW LEVEL SECURITY;

CREATE POLICY session_folders_select ON session_folders
  FOR SELECT
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

CREATE POLICY session_folders_modify ON session_folders
  FOR ALL
  USING (
    org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

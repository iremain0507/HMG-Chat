-- 0029 · session_folders.parent_folder_id (Phase 20 — 중첩 폴더 계층,
-- Open WebUI Nested Folders 참고, P20-T1-06)
-- 단일 출처: apps/server/src/db/session-folder-data-access.ts, apps/server/src/routes/folders.ts
-- nullable-first: DEFAULT 없는 신규 nullable FK — 기존 폴더는 전부 parent_folder_id IS NULL
--   (root, 기존 flat 동작 무변경).
-- 롤백 경로: dev/staging 전용 — ALTER TABLE session_folders DROP COLUMN parent_folder_id.
--            prod 는 forward-only 정책.
-- RLS: session_folders 기존 정책(0019_session_folders.sql)을 컬럼 추가만으로 그대로 재사용
--   (정책 조건이 org_id/created_by 라 신규 컬럼과 무관).
-- 순환참조 방어: FK 는 self-reference 를 막지 않으므로(테이블 자기참조), 순환/자기참조 거부는
--   application 레벨(db/session-folder-data-access.ts wouldCreateCycle)에서 강제한다.

ALTER TABLE session_folders
  ADD COLUMN parent_folder_id UUID REFERENCES session_folders(id) ON DELETE SET NULL;

CREATE INDEX session_folders_parent_idx ON session_folders(parent_folder_id)
  WHERE parent_folder_id IS NOT NULL;

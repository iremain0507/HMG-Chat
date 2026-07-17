-- 0028 · session_folders.system_prompt (Phase 20 — 폴더 스코프 시스템 프롬프트 상속,
-- Open WebUI Folder System Prompt 참고, P20-T1-03)
-- 단일 출처: apps/server/src/routes/folders.ts(PATCH), apps/server/src/routes/messages.ts(상속 배선)
-- nullable-first: DEFAULT 없는 신규 nullable 컬럼 — 기존 폴더는 전부 system_prompt IS NULL(미설정)로
--   시작, 상속 로직은 NULL/빈 문자열이면 스킵(기존 동작 무변경).
-- 롤백 경로: dev/staging 전용 — ALTER TABLE session_folders DROP COLUMN system_prompt.
--            prod 는 forward-only 정책.
-- RLS: session_folders 기존 정책(0019_session_folders.sql)을 컬럼 추가만으로 그대로 재사용
--   (정책 조건이 org_id/created_by 라 신규 컬럼과 무관).

ALTER TABLE session_folders ADD COLUMN system_prompt TEXT;

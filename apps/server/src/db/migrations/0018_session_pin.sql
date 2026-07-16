-- 0018 · sessions.pinned_at (Phase 19 — 세션 핀 서버 영속)
-- 배경: 기존엔 lib/pinnedSessions.ts 로 localStorage-only 였음(기기 간 미동기화, P17-T1-03 주석 참조).
--       Open WebUI 대비 gap — 서버 영속으로 승격.
-- 단일 출처: rebuild_plan/16-API-CONTRACT.md § Sessions, apps/server/src/routes/sessions.ts
-- 롤백 경로: dev/staging 전용 — ALTER TABLE sessions DROP COLUMN pinned_at.
--            prod 는 forward-only 정책 (nullable-first 신규 컬럼이라 안전).
-- nullable-first: 기존 sessions row 는 전부 pinned_at IS NULL(미고정)로 시작 — 기존 동작 무변경.
-- RLS: 0002_sessions_messages.sql 의 sessions_owner 정책(user_id 기준)이 이미 이 컬럼에도 적용됨
--      (컬럼 추가는 정책 재정의 불필요 — FOR ALL USING (user_id = ...) 는 전체 컬럼에 적용).

ALTER TABLE sessions ADD COLUMN pinned_at TIMESTAMPTZ;

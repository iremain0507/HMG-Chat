-- 0021 · sessions.archived_at 인덱스 (Phase 19 — 세션 아카이브 기본목록 제외/필터)
-- 배경: archived_at 컬럼 자체는 0002_sessions_messages.sql 에서 이미 존재(TS-09 PATCH /:id
--       rename/archived 용). 이번 phase 는 GET /sessions 기본 목록에서 archived 세션 제외 +
--       ?archived=true 필터(신규 PATCH /:id/archive 토글)를 추가하며, WHERE user_id=..
--       AND archived_at IS [NOT] NULL 조회 패턴이 새로 생겨 인덱스로 지원한다.
-- 단일 출처: rebuild_plan/16-API-CONTRACT.md § GET /sessions?...&archived
-- 롤백 경로: dev/staging = DROP INDEX idx_sessions_user_archived. prod 는 forward-only 정책
--            (인덱스만 추가라 신규 컬럼 없음 — nullable-first 해당 없음, 안전).
-- RLS: 0002_sessions_messages.sql 의 sessions_owner 정책(user_id 기준)이 이미 archived_at
--      컬럼에도 적용됨 — 신규 정책 불필요.

CREATE INDEX IF NOT EXISTS idx_sessions_user_archived ON sessions (user_id, archived_at);

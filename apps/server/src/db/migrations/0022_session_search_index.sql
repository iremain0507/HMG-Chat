-- 0022 · 세션 검색 GIN 인덱스 (Phase 19 — 메시지 내용 검색, Open WebUI 참고 gap Ⓑ)
-- 배경: GET /api/v1/sessions/search?q= (routes/sessions.ts) 가 sessions.title 과
--       messages.content(JSONB, ::text 캐스트) 를 ILIKE '%q%' 로 매칭한다. pg_trgm
--       extension(0001_identity.sql 에서 이미 설치)의 GIN 인덱스로 부분일치 검색을 가속한다.
-- 단일 출처: apps/server/src/routes/sessions.ts § GET /search, feature_list.json P19-T1-06
-- 롤백 경로: dev/staging = DROP INDEX idx_sessions_title_trgm; DROP INDEX idx_messages_content_trgm.
--            prod 는 forward-only 정책(인덱스만 추가, 신규 컬럼 없음 — nullable-first 해당 없음).
-- RLS: 기존 sessions_owner/messages_via_session 정책(0002_sessions_messages.sql)이 그대로
--      적용된다 — 신규 정책 불필요(인덱스는 정책과 무관).

CREATE INDEX IF NOT EXISTS idx_sessions_title_trgm
  ON sessions USING GIN (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_messages_content_trgm
  ON messages USING GIN ((content::text) gin_trgm_ops);

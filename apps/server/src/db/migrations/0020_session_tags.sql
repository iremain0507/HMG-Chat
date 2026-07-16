-- 0020 · session_tags (Phase 19 — 세션 태그+필터, Open WebUI 참고 gap Ⓑ)
-- 단일 출처: apps/server/src/routes/sessions.ts(POST/DELETE /:id/tags, GET /?tag= 필터)
-- 롤백 경로: dev/staging 전용 — DROP TABLE session_tags. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0019 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: sessions 는 user_id 로만 소유(org_id 컬럼 없음, users.org_id 로 파생) — session_tags
--   는 session_folders(0019)와 동일하게 org_id 를 직접 들고 RLS 방어선을 만든다. 사용자 단위
--   격리는 session_id 자체가 sessions.user_id 소유 세션으로 한정되므로(application 레벨,
--   routes/sessions.ts 가 세션 ownership 을 먼저 검증) 별도 created_by 컬럼은 두지 않는다.

CREATE TABLE session_tags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, tag)
);
CREATE INDEX session_tags_session_idx ON session_tags(session_id);
CREATE INDEX session_tags_org_tag_idx ON session_tags(org_id, tag);

ALTER TABLE session_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_tags FORCE ROW LEVEL SECURITY;

CREATE POLICY session_tags_select ON session_tags
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY session_tags_modify ON session_tags
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

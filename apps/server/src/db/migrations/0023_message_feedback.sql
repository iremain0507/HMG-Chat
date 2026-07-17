-- 0023 · message_feedback (Phase 19 — 메시지 평가 👍/👎, Open WebUI 참고 gap Ⓒ)
-- 단일 출처: apps/server/src/routes/sessions.ts
--   (POST/GET /:id/messages/:messageId/feedback)
-- 롤백 경로: dev/staging 전용 — DROP TABLE message_feedback. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0022 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: messages 는 session_id 로만 소유(org_id 컬럼 없음) — session_tags(0020)/
--   session_folders(0019)와 동일하게 org_id 를 직접 들고 RLS 방어선을 만든다. 사용자 단위
--   평가 유일성은 user_id 로 직접 표현(UNIQUE(message_id, user_id)) — 메시지 자체의 ownership
--   (message.session_id 가 요청자 소유 세션인지)은 application 레벨에서 먼저 검증한다
--   (routes/sessions.ts 가 sessions.byId + messages.byId 로 확인).

CREATE TABLE message_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX message_feedback_message_idx ON message_feedback(message_id);
CREATE INDEX message_feedback_org_idx ON message_feedback(org_id);
CREATE TRIGGER message_feedback_touch BEFORE UPDATE ON message_feedback
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

ALTER TABLE message_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_feedback FORCE ROW LEVEL SECURITY;

CREATE POLICY message_feedback_select ON message_feedback
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY message_feedback_modify ON message_feedback
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

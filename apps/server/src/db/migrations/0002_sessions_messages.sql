-- 0002 · sessions + messages
-- 적용 시점: Phase 2
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 부록 F (본문 그대로)
-- 롤백 경로: dev/staging 전용 — DROP TABLE messages; DROP TABLE sessions;
--            prod 는 forward-only 정책 (신규 테이블이라 안전, nullable-first 고려 대상 컬럼 없음).

-- 주의: project_id 컬럼은 본 마이그레이션에서 nullable UUID 로만 만들고,
-- FK constraint 는 0004 끝부분에서 추가 (projects 테이블 생성 후).

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID,                                              -- FK 는 0004 에서 추가
  title TEXT,
  archived_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_lastmsg_idx ON sessions(user_id, last_message_at DESC);
CREATE TRIGGER sessions_touch BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system','tool')),
  content JSONB NOT NULL,
  tool_call_ids TEXT[],
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  tokens_in INT,
  tokens_out INT,
  cost_micros BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_session_created_idx ON messages(session_id, created_at);
CREATE INDEX sessions_project_idx ON sessions(project_id) WHERE project_id IS NOT NULL;

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- sessions: 본인 세션만
-- NOTE: current_setting(...)::uuid 대신 NULLIF(..., '')::uuid 사용 — Postgres 는 SET LOCAL 로
-- 생성된 커스텀 GUC 를 ROLLBACK 후 NULL 이 아닌 빈 문자열로 되돌리는데, 그 상태에서 바로 ::uuid
-- 캐스트하면 "invalid input syntax for type uuid" 로 깨진다 (0001_identity.sql 에서 발견/수정된
-- 버그와 동일 패턴, § P1-T1-01). NULLIF 로 빈 문자열을 NULL 로 바꿔 정책이 안전하게 닫히게 한다.
CREATE POLICY sessions_owner ON sessions
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- messages: 자신의 세션 안의 메시지만
CREATE POLICY messages_via_session ON messages
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = messages.session_id
      AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

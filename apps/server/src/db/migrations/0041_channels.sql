-- 0041 · channels (Phase 22 — 실시간 다중사용자 채널, P22-T6-12)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C8 (docs/rfc/P22-contract-batch.md § C8).
--   승인문 26-27 행: "엔터프라이즈 단위(C8/C14/C15/C16)가 요구하는 후속 migration(0040+)도
--   동일 원칙 하에 승인". 0040 은 scim 이 선점 → _journal.json idx 연속 규칙에 따라 0041.
-- 단일 출처: packages/interfaces/src/types.ts 의 Channel/ChannelMember/ChannelMessage/
--   ChannelReaction + 동명 Repo, apps/server/src/db/channel-data-access.ts(CRUD),
--   apps/server/src/routes/channels.ts(REST + SSE).
-- 설계: notes(0037) 미러 — org 스코프 + RLS 격리. 다만 채널은 소유자 전용이 아니라
--   "org 전체에 보이고 멤버만 글을 쓰는" 공용 공간이라, 멤버십 강제는 라우트가
--   application 레벨에서 수행한다(dev/test DATABASE_URL role 이 superuser 라 RLS 우회).
-- nullable-first: 전부 신규 테이블이라 기존 행 백필 없음. channel_messages.user_id 는
--   NULL 허용 — @model 멘션에 대한 assistant 응답은 사람 작성자가 없다.
-- 롤백 경로: dev/staging 전용 — 역순 DROP(channel_reactions → channel_messages →
--   channel_members → channels). FK ON DELETE CASCADE 라 channels 만 지워도 정리된다.
--   prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0040 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE channels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX channels_org_updated_idx ON channels(org_id, updated_at DESC);

CREATE TABLE channel_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, user_id)
);
CREATE INDEX channel_members_user_idx ON channel_members(org_id, user_id);

CREATE TABLE channel_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  -- NULL = assistant(@model) 메시지. 사람 작성자가 없다.
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  role       TEXT NOT NULL DEFAULT 'user',
  content    TEXT NOT NULL DEFAULT '',
  -- 스레드 답글이면 부모 메시지. 최상위 글이면 NULL.
  parent_id  UUID REFERENCES channel_messages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX channel_messages_channel_created_idx
  ON channel_messages(org_id, channel_id, created_at ASC);
CREATE INDEX channel_messages_parent_idx ON channel_messages(parent_id);

CREATE TABLE channel_reactions (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES channel_messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 같은 사람이 같은 글에 같은 이모지를 두 번 달 수 없다(토글 UX 의 DB 측 보증).
  UNIQUE (message_id, user_id, emoji)
);
CREATE INDEX channel_reactions_message_idx ON channel_reactions(message_id);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels FORCE ROW LEVEL SECURITY;
CREATE POLICY channels_org_isolation ON channels
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_members_org_isolation ON channel_members
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_messages_org_isolation ON channel_messages
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

ALTER TABLE channel_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY channel_reactions_org_isolation ON channel_reactions
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

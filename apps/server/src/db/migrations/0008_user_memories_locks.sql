-- 0008 · user_memories + memory_extraction_locks (Phase 7 — Memory System)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0008_user_memories.sql
-- 컬럼 spec: 14-INTERFACES § UserMemory 와 1:1 일치. memory_extraction_locks 는 도메인 타입 없음
-- (Redis-like, DB 로 durability 확보하는 내부 lock 메커니즘 — db/memory-extraction-lock.ts 가 사용).
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0007 과 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).

CREATE TABLE user_memories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('user','feedback','project','reference')),
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('auto-extract','manual')),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX user_memories_user_cat_idx
  ON user_memories(user_id, category, pinned DESC, created_at DESC);
CREATE TRIGGER user_memories_touch BEFORE UPDATE ON user_memories
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE memory_extraction_locks (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE user_memories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_extraction_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_memories_owner ON user_memories
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

CREATE POLICY memory_locks_via_session ON memory_extraction_locks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = memory_extraction_locks.session_id
      AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

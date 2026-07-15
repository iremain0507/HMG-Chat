-- 0014 · uploads + ephemeral_chunks (세션 첨부 파일 — routes/uploads.ts 의존)
-- 적용 시점: Phase 4 (0005 직후 — journal 등록 순서 참고)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0014_uploads.sql
-- 컬럼 spec: 14-INTERFACES § UploadRecord / EphemeralChunk 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP CASCADE.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0005/0015 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).

-- 세션 첨부 파일 (project_documents 와 별개 — 단발성, 30일 만료)
CREATE TABLE uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,                                       -- dedup + 무결성
  expires_at TIMESTAMPTZ NOT NULL,                            -- 30일 후 자동 정리
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uploads_user_sha_unique UNIQUE (user_id, sha256)
);
CREATE INDEX uploads_user_created_idx ON uploads(user_id, created_at DESC);
-- partial index 의 predicate 는 IMMUTABLE 함수만 허용 — NOW() 사용 불가.
-- 대신 단순 expires_at 인덱스 + cron job 이 `WHERE expires_at < NOW()` 로 조회.
CREATE INDEX uploads_expires_idx ON uploads(expires_at);

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

-- SELECT: 본인 업로드만
CREATE POLICY uploads_owner_select ON uploads
  FOR SELECT
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- INSERT/UPDATE/DELETE: 본인만
CREATE POLICY uploads_owner_modify ON uploads
  FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- 세션 ephemeral RAG 인덱스 — 채팅 첨부 파일의 chunk + embedding.
-- 16-API-CONTRACT § POST /sessions/:id/messages 의 RAG 흐름 단일 출처.
-- project_documents 와 다르게 session 종료 시 자동 cascade delete.
CREATE TABLE ephemeral_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  upload_id UUID NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  page_number INT,                                              -- citation 용 (PDF/PPT). null = N/A (text 등)
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL,                              -- voyage-multilingual-2 dim
  bm25_tsv tsvector,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,                  -- { heading, section, char_start, char_end, ... } — citation/스니펫
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ephemeral_chunks_session_idx ON ephemeral_chunks(session_id);
CREATE INDEX ephemeral_chunks_upload_idx ON ephemeral_chunks(upload_id);
CREATE INDEX ephemeral_chunks_embedding_idx ON ephemeral_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m=16, ef_construction=64);
CREATE INDEX ephemeral_chunks_tsv_idx ON ephemeral_chunks USING gin(bm25_tsv);

ALTER TABLE ephemeral_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY ephemeral_chunks_session_owner ON ephemeral_chunks
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = ephemeral_chunks.session_id
      AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  ));

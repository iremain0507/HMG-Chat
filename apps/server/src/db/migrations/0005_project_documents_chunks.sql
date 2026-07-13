-- 0005 · project_documents + document_chunks (pgvector + tsvector)
-- 적용 시점: Phase 4 (0015 직후 — journal 등록 순서 참고)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0005_documents_chunks.sql
-- 컬럼 spec: 14-INTERFACES § ProjectDocumentRecord / DocumentChunk 와 1:1 일치.
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP CASCADE.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0004/0015 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).
-- NOTE: user_can_read_project/user_can_write_project 는 0015 도 CREATE OR REPLACE 하므로 본문 동일하게 유지
--       (0015 가 0005 보다 먼저 적용된 journal 순서라도, 0005 가 재정의해도 결과는 동일 — idempotent).
-- NOTE: 0015 는 project_documents/document_chunks 가 없으면 to_regclass guard 로 정책 생성을 skip 한다
--       (§ 0015 주석) — 본 마이그레이션이 그 skip 된 정책을 여기서 동일하게 생성해 채운다.

CREATE TABLE project_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  index_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (index_status IN ('pending','parsing','chunking','embedding','indexed','failed')),
  chunk_count INT NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_documents_dedup UNIQUE (project_id, content_hash)
);
CREATE INDEX project_documents_project_status_idx ON project_documents(project_id, index_status);
CREATE TRIGGER project_documents_touch BEFORE UPDATE ON project_documents FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE document_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT,
  embedding VECTOR(1024),
  content_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);
CREATE INDEX document_chunks_hnsw_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX document_chunks_tsv_idx ON document_chunks USING gin(content_tsv);

ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION user_can_read_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    WHERE p.id = p_project_id
      AND p.org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
      AND (
        p.visibility = 'org'
        OR (p.visibility = 'team' AND EXISTS (
          SELECT 1 FROM user_org_units uou
          WHERE uou.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
            AND uou.org_unit_id = p.org_unit_id))
        OR EXISTS (SELECT 1 FROM project_members pm
                   WHERE pm.project_id = p.id
                     AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
      )
  );
$$;

CREATE OR REPLACE FUNCTION user_can_write_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members pm
    WHERE pm.project_id = p_project_id
      AND pm.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND pm.role IN ('owner','editor')
  );
$$;
REVOKE EXECUTE ON FUNCTION user_can_read_project(UUID)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION user_can_write_project(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_read_project(UUID)  TO PUBLIC;
GRANT  EXECUTE ON FUNCTION user_can_write_project(UUID) TO PUBLIC;

-- project_documents: SELECT 는 read 권한, INSERT/UPDATE/DELETE 는 write 권한
CREATE POLICY pd_select ON project_documents
  FOR SELECT USING (user_can_read_project(project_id));
CREATE POLICY pd_insert ON project_documents
  FOR INSERT WITH CHECK (user_can_write_project(project_id));
CREATE POLICY pd_update ON project_documents
  FOR UPDATE USING (user_can_write_project(project_id))
              WITH CHECK (user_can_write_project(project_id));
CREATE POLICY pd_delete ON project_documents
  FOR DELETE USING (user_can_write_project(project_id));

-- document_chunks: 부모 document 의 권한 따름
CREATE POLICY dc_select ON document_chunks
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_read_project(pd.project_id)));
CREATE POLICY dc_insert ON document_chunks
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));
CREATE POLICY dc_update ON document_chunks
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)))
  WITH CHECK (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));
CREATE POLICY dc_delete ON document_chunks
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM project_documents pd
            WHERE pd.id = document_chunks.document_id
              AND user_can_write_project(pd.project_id)));

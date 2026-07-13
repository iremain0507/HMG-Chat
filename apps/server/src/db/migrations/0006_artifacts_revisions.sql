-- 0006 · artifacts + artifact_revisions (Phase 5 — routes/artifacts.ts 의존)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0006_artifacts.sql
-- 컬럼 spec: 14-INTERFACES § ArtifactRecord 와 1:1 일치.
-- storage_kind 분기: 16-API-CONTRACT § 7 Artifacts — sizeBytes < 256_000 → inline(DB BYTEA), 그 외 → s3.
-- 롤백 경로: dev/staging 전용 — 두 테이블 DROP CASCADE.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0005/0014/0015 와 동일 사유
--       (SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성, § P1-T1-01 에서 발견/확정).

CREATE TABLE artifacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,   -- nullable (L03) — session 삭제돼도 artifact 는 보존
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK (type IN ('pptx','pdf','docx','xlsx','markdown','html','image','other')),
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT NOT NULL,
  s3_key TEXT,
  storage_kind TEXT NOT NULL CHECK (storage_kind IN ('inline','s3')),
  inline_content BYTEA,                    -- storage_kind='inline' 인 경우 (DB BYTEA)
  shared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (storage_kind = 'inline' AND inline_content IS NOT NULL AND s3_key IS NULL) OR
    (storage_kind = 's3'     AND s3_key IS NOT NULL AND inline_content IS NULL)
  )
);
CREATE INDEX artifacts_session_created_idx ON artifacts(session_id, created_at);
CREATE INDEX artifacts_creator_idx ON artifacts(created_by);
CREATE TRIGGER artifacts_touch BEFORE UPDATE ON artifacts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE artifact_revisions (
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INT NOT NULL,
  s3_key TEXT NOT NULL,
  diff_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (artifact_id, version)
);

ALTER TABLE artifacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifact_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY artifacts_owner_or_session ON artifacts
  FOR ALL
  USING (
    created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM sessions s
               WHERE s.id = artifacts.session_id
                 AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  );

CREATE POLICY artifact_revisions_via_artifact ON artifact_revisions
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM artifacts a
    WHERE a.id = artifact_revisions.artifact_id
      AND (a.created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
           OR EXISTS (SELECT 1 FROM sessions s
                      WHERE s.id = a.session_id
                        AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  ));

-- 0037 · notes (Phase 22 — 노트 워크스페이스, P22-T6-17)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C7 (docs/rfc/P22-contract-batch.md § C7).
--   RFC 초안은 파일명을 0035_notes 로 예시했으나 0035 는 provider_connections,
--   0036 은 user_language 가 선점 → _journal.json idx 연속 규칙에 따라 0037.
--   (승인 범위는 0032~0039 + "후속 migration 도 동일 원칙 하에 승인".)
-- 단일 출처: packages/interfaces/src/types.ts 의 Note / NoteRepo,
--   apps/server/src/db/note-data-access.ts(CRUD), apps/server/src/routes/notes.ts(REST).
-- 설계: agents(0034) 미러 — org 스코프 + RLS 격리. 다만 노트는 공유 개념이 없어
--   소유자(user_id) 전용이며, 소유권 강제는 라우트가 application 레벨에서 수행한다
--   (dev/test DATABASE_URL role 이 superuser 라 RLS 를 우회하기 때문).
-- nullable-first: 신규 테이블이라 기존 행 백필 없음. title/content 는 빈 문자열 기본값이 있어
--   NOT NULL 이어도 생성 시 입력이 강제되지 않는다.
-- 롤백 경로: dev/staging 전용 — DROP TABLE notes. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0036 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX notes_owner_updated_idx ON notes(org_id, user_id, updated_at DESC);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes FORCE ROW LEVEL SECURITY;

CREATE POLICY notes_org_isolation ON notes
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

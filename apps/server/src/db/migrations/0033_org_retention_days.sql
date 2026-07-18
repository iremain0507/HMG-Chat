-- 0033 · organizations.retention_days (메시지 보존정책)
-- 단일 출처: rebuild_plan/12-OPS-SECURITY.md 부록 H 3번, packages/interfaces Organization.
-- 계약배치: docs/rfc/P22-contract-batch.md § C2 (.ralph/CONTRACT_APPROVED 승인됨).
--
-- nullable-first: NULL = 무기한 보존(= 이 컬럼 도입 이전의 기존 동작). 백필 불필요하며
--   data-retention.ts 는 retention_days IS NULL 인 org 의 메시지를 절대 삭제하지 않는다.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE organizations DROP CONSTRAINT
--   organizations_retention_days_positive; ALTER TABLE organizations DROP COLUMN retention_days;
--   prod 는 forward-only 정책(12-OPS-SECURITY.md § migration).
ALTER TABLE organizations
  ADD COLUMN retention_days INTEGER;                -- NULL = 무기한 보존

ALTER TABLE organizations
  ADD CONSTRAINT organizations_retention_days_positive
  CHECK (retention_days IS NULL OR retention_days > 0);

-- 보존 삭제 쿼리(messages → sessions → users → org)가 org 별 cutoff 스캔을 하므로
-- messages_session_created_idx(session_id, created_at) 만으로는 org 단위 스캔이 넓다.
-- created_at 단독 인덱스로 cutoff 필터를 먼저 좁힌다(부록 H 3·4·5 cron 전용).
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages(created_at);

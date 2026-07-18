-- 0036 · users.language (사용자별 UI 언어) — P22-T6-15 / 계약배치 C11
-- nullable-first: NULL = 서버 기본 'ko'(기존 동작). 백필 불필요.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE users DROP COLUMN language; (prod 는 forward-only)
ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT;

-- BCP-47 형태만 허용(런타임 검증과 이중 방어). NULL 은 항상 허용.
ALTER TABLE users ADD CONSTRAINT users_language_bcp47
  CHECK (language IS NULL OR language ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$');

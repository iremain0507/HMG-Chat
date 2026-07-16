-- 0025 · api_keys (Phase 19 — API 키 발급/폐기 + Bearer 인증, Open WebUI 참고 gap Admin)
-- 단일 출처: apps/server/src/routes/api-keys.ts (POST/GET/DELETE /api/v1/api-keys),
--   apps/server/src/middleware/auth-middleware.ts (Authorization: Bearer <key> 를 JWT 대체로 수용)
-- 롤백 경로: dev/staging 전용 — DROP TABLE api_keys. prod 는 forward-only 정책.
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0024 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 보안: 평문 키는 저장하지 않는다 — key_hash(sha256 hex, routes/auth.ts hashToken 과 동일 패턴)만
--   저장, key_prefix(마스킹 표시용, 평문 키 앞부분)는 목록 UI 식별용으로만 별도 보관.
-- 소유 모델: 키는 발급한 user 본인만 조회/폐기(self-service) — org_id 는 RLS 방어선,
--   user_id 로 owner 단위 격리는 application 레벨(db/api-key-data-access.ts)에서 강제
--   (prompts private access 와 동일한 이중 방어 패턴).

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX api_keys_org_idx ON api_keys(org_id);
CREATE INDEX api_keys_user_idx ON api_keys(user_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY api_keys_select ON api_keys
  FOR SELECT
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

CREATE POLICY api_keys_modify ON api_keys
  FOR ALL
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- 0013 · refresh_token_families
-- 적용 시점: Phase 1 (auth flow 확정 후, 0012 이후)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0013 (본문 그대로)
-- 롤백 경로: dev/staging 전용 — DROP TABLE refresh_token_families;
--            prod 는 forward-only 정책 (신규 테이블이라 안전, nullable-first 고려 대상 컬럼 없음).

-- JWT refresh rotation 의 family 추적 (12-OPS-SECURITY.md § 부록 A 의 도난 감지 정책 구현)
-- 각 family 안에서 한 번에 valid 한 refresh token 은 1개.
-- 같은 family 의 같은 generation 이 두 번 사용되면 → 도난 의심 → 전체 family revoke.

CREATE TABLE refresh_token_families (
  family_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_generation INT NOT NULL DEFAULT 1,                 -- rotate 시 +1
  current_jti UUID NOT NULL DEFAULT uuid_generate_v4(),      -- 현재 valid token 의 jti claim
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,                                    -- 도난 감지 또는 logout 시
  revoke_reason TEXT CHECK (revoke_reason IN ('theft_suspected','logout','admin','expired'))
);
CREATE INDEX refresh_token_families_user_active_idx
  ON refresh_token_families(user_id) WHERE revoked_at IS NULL;

ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY rtf_owner ON refresh_token_families
  FOR ALL
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- 도난 감지 흐름 (application code 가 호출, apps/server/src/middleware/jwt.ts 에서 구현 예정 — P1-T1-04):
-- 1. refresh 요청의 family_id + jti 검증
-- 2. current_jti 와 다르면 (= 이전 generation 의 token) → 도난 의심 → 전체 family revoke
-- 3. current_jti 와 같으면 → 새 jti 생성, current_generation++, last_used_at = NOW()

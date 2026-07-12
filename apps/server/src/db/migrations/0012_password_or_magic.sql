-- 0012 · password_hash + magic_link_tokens
-- 적용 시점: Phase 1 (auth flow 확정 후)
-- 단일 출처: rebuild_plan/06-DATA-MODEL.md § 0012 (본문 그대로)
-- 롤백 경로: dev/staging 전용 — DROP FUNCTION create_user_from_magic_link(TEXT);
--            DROP TABLE magic_link_tokens; ALTER TABLE users DROP COLUMN password_hash, DROP COLUMN magic_link_salt;
--            prod 는 forward-only 정책 (L03 nullable-first 신규 컬럼이라 안전).
-- nullable-first: password_hash/magic_link_salt 는 NULL 허용 컬럼으로 추가 (기존 row 영향 없음).

-- v1.0 결정: magic-link 우선 (password 는 admin 계정용으로만 유지)
ALTER TABLE users
  ADD COLUMN password_hash TEXT,                              -- bcrypt cost 12, NULL = magic-link only
  ADD COLUMN magic_link_salt TEXT;                            -- HMAC 입력

-- magic-link 토큰 (Redis primary, DB backup. signup 흐름에서는 user 가 아직 없을 수 있어 user_id nullable)
CREATE TABLE magic_link_tokens (
  token_hash TEXT PRIMARY KEY,                                -- sha256(token)
  email CITEXT NOT NULL,                                      -- signup 흐름 (user 미존재) 시 식별 키
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,        -- 기존 사용자면 채워짐
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE, -- email 도메인 매칭으로 결정된 org. 14/16 MagicLinkTokenRecord.orgId (non-null) 와 일관.
  intent TEXT NOT NULL CHECK (intent IN ('signup','login')),
  signup_name TEXT,                                           -- intent='signup' 일 때 verify 시점에 users.name 으로 복원. NULL 허용 (login 흐름).
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX magic_link_tokens_email_idx ON magic_link_tokens(email)
  WHERE used_at IS NULL;
CREATE INDEX magic_link_tokens_expires_idx ON magic_link_tokens(expires_at)
  WHERE used_at IS NULL;

-- magic-link signup verify 시점에 새 user row 를 만드는 SECURITY DEFINER 함수.
-- 이유: 0001 의 users RLS (users_select_same_org / users_modify_self) 가 app.user_id 설정을 가정.
-- signup 흐름에선 user 가 아직 없어 app.user_id 미설정 → 일반 INSERT 가 RLS 에 막힘.
-- 본 함수가 (a) magic_link_tokens 검증 (token_hash + expiry + intent='signup' + 미사용) →
--          (b) users INSERT (org_id 는 token row 의 도메인 매칭으로 결정) →
--          (c) magic_link_tokens.used_at = NOW() → (d) 새 user.id 반환.
-- 호출자: apps/server/src/routes/auth.ts 의 magic-link verify handler.
-- 14-INTERFACES § MagicLinkTokenRepo 는 본 함수만 wrap (다른 경로로 user INSERT 금지).
CREATE OR REPLACE FUNCTION create_user_from_magic_link(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_row magic_link_tokens%ROWTYPE;
  v_user_id UUID;
BEGIN
  -- 1) token row lock + 검증
  SELECT * INTO v_row FROM magic_link_tokens
    WHERE token_hash = p_token_hash
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'magic_link_token not found' USING ERRCODE = 'NO_DATA_FOUND';
  END IF;
  IF v_row.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'magic_link_token already used' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'magic_link_token expired' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.intent <> 'signup' THEN
    RAISE EXCEPTION 'create_user_from_magic_link: intent must be signup, got %', v_row.intent;
  END IF;
  IF v_row.user_id IS NOT NULL THEN
    RAISE EXCEPTION 'create_user_from_magic_link: token already linked to user %', v_row.user_id;
  END IF;
  -- 2) users INSERT (RLS 우회 — SECURITY DEFINER 권한)
  INSERT INTO users (org_id, email, name, role, status)
    VALUES (v_row.org_id, v_row.email, COALESCE(v_row.signup_name, v_row.email), 'member', 'active')
    RETURNING id INTO v_user_id;
  -- 3) magic_link_tokens 의 user_id + used_at 갱신
  UPDATE magic_link_tokens
    SET user_id = v_user_id, used_at = NOW()
    WHERE token_hash = p_token_hash;
  RETURN v_user_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION create_user_from_magic_link(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION create_user_from_magic_link(TEXT) TO PUBLIC;
-- 보안: SECURITY DEFINER 이지만 위 검증 (token 존재 + 미사용 + 미만료 + intent='signup' + 미링크) 이 권한 우회 차단.
-- 호출 후 server 가 동일 트랜잭션 안에서 SET LOCAL app.user_id = <new id> 를 즉시 실행해야 후속 RLS 통과.

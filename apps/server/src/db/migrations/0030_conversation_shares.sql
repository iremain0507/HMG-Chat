-- 0030 · conversation_shares (Phase 20 — 대화 스냅샷 공유 링크(불변), Open WebUI Share Link 참고,
-- P20-T1-08)
-- 단일 출처: apps/server/src/db/conversation-share-service.ts(스냅샷 생성/조회/revoke),
--   apps/server/src/routes/conversation-share.ts(인증 발급/revoke + 공개 조회)
-- 기존 '대화 공유'(artifact_shares, 0007)는 세션의 최신 아티팩트만 토큰화한다 — 대화 전체를
--   시점 고정(snapshot JSONB)해 공유하는 것은 별도 테이블이 필요(불변성: 원본 세션/메시지가
--   이후 수정/삭제돼도 공개 링크가 보여주는 내용은 발급 시점 그대로).
-- nullable-first: 신규 테이블이라 해당 없음(기존 테이블 컬럼 추가 아님).
-- 롤백 경로: dev/staging 전용 — DROP TABLE conversation_shares. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0029 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).
-- 소유 모델: resource_grants(0027)·groups(0026)와 동일하게 org_id 를 직접 들고 RLS 방어선을
--   만든다(artifact_shares(0007)처럼 join 을 통한 SECURITY DEFINER 함수가 불필요 — sessions 는
--   org 를 직접 들지 않지만 발급 시점의 auth.org(JWT claim)를 그대로 저장).
-- expires_at 은 nullable(무기한 공유 허용) — artifact_shares 와 달리 ttl 강제가 이 태스크
--   acceptance 범위 밖(대화 스냅샷은 링크를 아는 한 계속 열람 가능한 것이 Open WebUI 기본 동작).

CREATE TABLE conversation_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot JSONB NOT NULL,
  token UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX conversation_shares_token_idx ON conversation_shares(token);
CREATE INDEX conversation_shares_org_idx ON conversation_shares(org_id);
CREATE INDEX conversation_shares_session_idx ON conversation_shares(session_id);

ALTER TABLE conversation_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_shares FORCE ROW LEVEL SECURITY;

-- 발급자 본인 또는 같은 org 의 admin 만 관리(조회/revoke) 가능. public /share/conversations/<token>
-- 조회는 별도 service-role connection(RLS 우회, artifact_shares/public-share.ts 와 동일 패턴).
CREATE POLICY conversation_shares_owner_or_admin ON conversation_shares
  FOR ALL
  USING (
    created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR (
      current_user_is_admin()
      AND org_id = NULLIF(current_setting('app.org_id', true), '')::uuid
    )
  );

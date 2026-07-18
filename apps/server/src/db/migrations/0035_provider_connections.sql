-- 0035 · provider_connections (Phase 22 — 외부 OpenAI 호환 provider 연결, P22-T6-14)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C6 (docs/rfc/P22-contract-batch.md § C6).
--   RFC 초안은 파일명을 0034_ 로 예시했으나 0034 는 agents(C5)가 선점 →
--   _journal.json idx 연속 규칙에 따라 다음 순번인 0035 로 배치(승인 범위 0032~0039 안).
-- 단일 출처: packages/interfaces/src/types.ts 의 ProviderConnection / ProviderConnectionRepo,
--   apps/server/src/db/provider-connection-data-access.ts(CRUD), apps/server/src/routes/connections.ts(REST).
-- 설계: agents(0034)/mcp_servers(0009) 미러 — org 스코프 + RLS 격리.
--
-- 비밀 취급: api_key_encrypted 는 KEK(lib/kek-provider.ts, AES-256-GCM)로 암호화된 BYTEA 이며
--   ProviderConnection DTO 에는 절대 담기지 않는다. 응답 표시는 key_prefix(앞 6자)만 사용한다.
--   복호화는 repo.secretById() 경로 하나뿐 — 라우트는 프로브(verify)/orchestrator 위임에만 쓴다.
-- nullable-first: 신규 테이블이라 기존 행 백필 없음. verified_at 은 검증 전 상태라 nullable.
-- 롤백 경로: dev/staging 전용 — DROP TABLE provider_connections. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0034 와
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE provider_connections (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  kind              TEXT NOT NULL DEFAULT 'openai-compatible'
                    CHECK (kind IN ('openai-compatible')),
  base_url          TEXT NOT NULL,
  api_key_encrypted BYTEA NOT NULL,
  key_prefix        TEXT NOT NULL,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  verified_at       TIMESTAMPTZ,
  models            TEXT[] NOT NULL DEFAULT '{}',
  created_by        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);
CREATE INDEX provider_connections_org_updated_idx
  ON provider_connections(org_id, updated_at DESC);

ALTER TABLE provider_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_connections FORCE ROW LEVEL SECURITY;

CREATE POLICY provider_connections_org_isolation ON provider_connections
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

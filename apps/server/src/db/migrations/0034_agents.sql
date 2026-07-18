-- 0034 · agents (Phase 22 — 커스텀 워크스페이스 에이전트 레지스트리, P22-T6-10)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C5 (docs/rfc/P22-contract-batch.md § C5).
--   RFC 초안은 파일명을 0033_ 로 예시했으나 0033 은 org_retention_days 가 선점 →
--   _journal.json idx 연속 규칙에 따라 다음 순번인 0034 로 배치(승인 범위 0032~0039 안).
-- 단일 출처: packages/interfaces/src/types.ts 의 Agent / AgentRepo,
--   apps/server/src/db/agent-data-access.ts(CRUD), apps/server/src/routes/agents.ts(REST).
-- 설계: mcp_servers(0009)/openapi_tool_servers(0032) 미러 — org 스코프 + RLS 격리.
--   visibility=private 은 작성자만, org 는 같은 org 전원에게 노출(강제는 라우트가 수행).
-- nullable-first: 신규 테이블이라 기존 행 백필 없음. description/system_prompt 는 선택 입력이라 nullable.
-- 롤백 경로: dev/staging 전용 — DROP TABLE agents. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0033 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  base_model    TEXT NOT NULL,
  system_prompt TEXT,
  tool_ids      TEXT[] NOT NULL DEFAULT '{}',
  skill_ids     TEXT[] NOT NULL DEFAULT '{}',
  project_ids   UUID[] NOT NULL DEFAULT '{}',
  visibility    TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private', 'org')),
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);
CREATE INDEX agents_org_updated_idx ON agents(org_id, updated_at DESC);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE ROW LEVEL SECURITY;

CREATE POLICY agents_org_isolation ON agents
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

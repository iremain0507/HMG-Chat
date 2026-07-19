-- 0038 · user_skills (Phase 22 — 사용자 작성/업로드 스킬, P22-T6-18)
-- 계약 승인: .ralph/CONTRACT_APPROVED 의 C12 (docs/rfc/P22-contract-batch.md § C12).
--   RFC 초안은 파일명을 0037_ 로 예시했으나 0037 은 notes 가 선점 →
--   _journal.json idx 연속 규칙에 따라 다음 순번인 0038 로 배치(승인 범위 0032~0039 안).
-- 단일 출처: packages/interfaces/src/SkillRegistry.ts 의 UserSkill / UserSkillStore,
--   apps/server/src/db/user-skill-data-access.ts(CRUD), apps/server/src/routes/skills.ts(REST).
-- 설계: 파일시스템 빌트인 스킬(skills/*, SkillRegistry)은 불변으로 남기고, 사용자 작성
--   스킬만 이 테이블에 둔다. 목록 응답에서 source='builtin'|'user' 로 구분된다.
-- 보안(승인 조건): SKILL.md 의 entryPoint 는 샌드박스 상대경로만 허용되고 permissions 는
--   'user' 티어로 강제된다 — 강제는 routes/skills.ts 가 저장 전에 수행한다.
-- nullable-first: 신규 테이블이라 기존 행 백필 없음. 모든 컬럼이 신규 입력이라 NOT NULL 안전.
-- 롤백 경로: dev/staging 전용 — DROP TABLE user_skills. prod 는 forward-only 정책.
--
-- NOTE: current_setting(...)::uuid bare cast 대신 NULLIF(..., '')::uuid 사용 — 0001~0037 과
--       동일 사유(SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 Postgres 특성).

CREATE TABLE user_skills (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    TEXT NOT NULL,
  skill_md   TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name, version)
);
CREATE INDEX user_skills_org_user_idx ON user_skills(org_id, user_id, updated_at DESC);

ALTER TABLE user_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_skills FORCE ROW LEVEL SECURITY;

CREATE POLICY user_skills_org_isolation ON user_skills
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

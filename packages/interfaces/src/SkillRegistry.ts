// packages/interfaces/src/SkillRegistry.ts
// § 7 — SKILL.md 디스커버리 + 활성화.
// 본 파일은 types.ts (PermissionTier) 만 import.

import type { PermissionTier } from "./types.js";

export interface SkillSpec {
  id: string; // 'wchat-pptx@1.0.0'
  name: string; // 'wchat-pptx'
  version: string; // '1.0.0' (semver strict, L09)
  description: string; // LLM 에 prompt 주입
  triggers: string[]; // 키워드 힌트
  entryPoint: string; // 'skills/wchat-pptx/scripts/build.py'
  permissions: PermissionTier; // 기본 'user'
  assets?: { filename: string; s3Key: string }[];
}

export interface SkillRegistry {
  list(scope: {
    orgId: string;
    userId: string;
    projectId?: string;
  }): Promise<SkillSpec[]>;
  byId(id: string): Promise<SkillSpec | null>; // 'wchat-pptx@1.0.0' 같은 id 조회
  reload(): Promise<void>;
}

/** 사용자가 작성/업로드한 스킬 레코드 (migration 0038_user_skills). */
export interface UserSkill {
  id: string; // uuid — SkillSpec.id('name@version') 와 구분되는 저장소 PK
  orgId: string;
  userId: string; // 작성자
  name: string;
  version: string;
  skillMd: string; // SKILL.md 원문(frontmatter 포함)
  enabled: boolean; // false 면 목록/주입 대상에서 제외
  createdAt: Date;
  updatedAt: Date;
}

/** 사용자 작성 스킬 저장소. 읽기 전용 SkillRegistry 와 분리해 파일시스템 기반
 *  빌트인 스킬의 불변성을 유지한다 (docs/rfc/P22-contract-batch.md § C12).
 *  보안: 업로드된 SKILL.md 의 entryPoint 는 반드시 샌드박스에서만 실행되고,
 *  permissions 는 'user' 티어로 강제된다(승인 조건). */
export interface UserSkillStore {
  create(input: {
    orgId: string;
    userId: string;
    name: string;
    version: string;
    skillMd: string;
  }): Promise<UserSkill>;
  update(
    id: string,
    input: { skillMd?: string; name?: string; version?: string },
  ): Promise<UserSkill>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  remove(id: string): Promise<void>;
  byId(id: string): Promise<UserSkill | null>;
  list(scope: { orgId: string; userId: string }): Promise<UserSkill[]>;
}

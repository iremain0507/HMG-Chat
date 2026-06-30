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

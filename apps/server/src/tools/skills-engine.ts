// tools/skills-engine.ts — 14-INTERFACES.md § 7 SkillRegistry 구현체.
// SKILL.md 는 server 만 읽는 순수 파일시스템 자산 (05-REPO-STRUCTURE.md: skills/* 는 어떤
// 패키지도 import 불가). frontmatter 는 새 dependency 추가 없이 정규식 기반 최소 파서로 처리
// (scripts/lint-skills.mjs 참조 초안, 15-CI-PIPELINE.md 와 동일 파싱 규칙 — L09).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WChatError,
  type PermissionTier,
  type SkillRegistry,
  type SkillSpec,
} from "@wchat/interfaces";

export interface SkillRegistryOptions {
  skillsDir: string;
}

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const PERMISSION_TIERS: readonly PermissionTier[] = [
  "system",
  "project",
  "user",
  "tool",
];
const SKILL_SCOPES = ["global", "org", "project", "user"] as const;
type SkillScope = (typeof SKILL_SCOPES)[number];

interface RegistryEntry {
  spec: SkillSpec;
  scope: SkillScope;
  orgId?: string;
  projectId?: string;
  userId?: string;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]+?)\n---/);
  const body = match?.[1];
  if (body === undefined) return null;
  const fields: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function parseListField(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function reject(skillDir: string, message: string): never {
  throw new WChatError(
    "SKILL_FRONTMATTER_INVALID",
    "parser",
    false,
    `skills/${skillDir}/SKILL.md: ${message}`,
  );
}

function buildEntry(
  skillDir: string,
  fields: Record<string, string>,
): RegistryEntry {
  const errors: string[] = [];
  if (!fields.name) errors.push("name missing");
  if (!fields.version || !SEMVER_RE.test(fields.version)) {
    errors.push("version not semver (x.y.z 형식이 아님)");
  }
  if (!fields.description || fields.description.length < 20) {
    errors.push("description < 20 chars");
  }
  if (!fields.entryPoint) errors.push("entryPoint missing");

  const scope = (fields.scope ?? "global") as SkillScope;
  if (!SKILL_SCOPES.includes(scope)) {
    errors.push(
      `scope invalid: '${fields.scope}' (${SKILL_SCOPES.join("|")} 중 하나여야 함)`,
    );
  }
  if (scope === "org" && !fields.orgId)
    errors.push("scope=org 인데 orgId missing");
  if (scope === "project" && !fields.projectId) {
    errors.push("scope=project 인데 projectId missing");
  }
  if (scope === "user" && !fields.userId)
    errors.push("scope=user 인데 userId missing");

  const permissions = (fields.permissions ?? "user") as PermissionTier;
  if (!PERMISSION_TIERS.includes(permissions)) {
    errors.push(`permissions invalid: '${fields.permissions}'`);
  }

  if (errors.length > 0) reject(skillDir, errors.join("; "));

  return {
    spec: {
      id: `${fields.name}@${fields.version}`,
      name: fields.name as string,
      version: fields.version as string,
      description: fields.description as string,
      triggers: parseListField(fields.triggers),
      entryPoint: fields.entryPoint as string,
      permissions,
    },
    scope,
    ...(fields.orgId !== undefined ? { orgId: fields.orgId } : {}),
    ...(fields.projectId !== undefined ? { projectId: fields.projectId } : {}),
    ...(fields.userId !== undefined ? { userId: fields.userId } : {}),
  };
}

/**
 * SKILL.md 원문 하나를 SkillSpec 으로 파싱한다 (P22-T6-18 / 계약 C12).
 * 파일시스템 로딩(loadEntries)과 **동일한 파서·검증 규칙**을 사용자 업로드 경로에서
 * 재사용하기 위한 export — 사용자 스킬은 디렉토리가 아니라 DB 본문에서 온다.
 * 검증 실패 시 loadEntries 와 같은 WChatError('SKILL_FRONTMATTER_INVALID') 를 던진다.
 */
export function parseSkillMarkdown(content: string, label: string): SkillSpec {
  const fields = parseFrontmatter(content);
  if (!fields) reject(label, "frontmatter missing");
  return buildEntry(label, fields).spec;
}

function loadEntries(skillsDir: string): RegistryEntry[] {
  if (!existsSync(skillsDir)) return [];
  const entries: RegistryEntry[] = [];
  for (const dirent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || dirent.name.startsWith("_")) continue;
    const skillMdPath = join(skillsDir, dirent.name, "SKILL.md");
    if (!existsSync(skillMdPath)) reject(dirent.name, "SKILL.md missing");
    const fields = parseFrontmatter(readFileSync(skillMdPath, "utf8"));
    if (!fields) reject(dirent.name, "frontmatter missing");
    entries.push(buildEntry(dirent.name, fields));
  }
  return entries;
}

function matchesScope(
  entry: RegistryEntry,
  scope: { orgId: string; userId: string; projectId?: string },
): boolean {
  switch (entry.scope) {
    case "global":
      return true;
    case "org":
      return entry.orgId === scope.orgId;
    case "project":
      return !!scope.projectId && entry.projectId === scope.projectId;
    case "user":
      return entry.userId === scope.userId;
  }
}

export function createSkillRegistry(opts: SkillRegistryOptions): SkillRegistry {
  let entries = loadEntries(opts.skillsDir);

  return {
    async list(scope) {
      return entries.filter((e) => matchesScope(e, scope)).map((e) => e.spec);
    },
    async byId(id) {
      return entries.find((e) => e.spec.id === id)?.spec ?? null;
    },
    async reload() {
      entries = loadEntries(opts.skillsDir);
    },
  };
}

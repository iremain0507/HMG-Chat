import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillRegistry } from "../skills-engine.js";

const SCOPE = { orgId: "org-1", userId: "user-1", projectId: "proj-1" };

function makeSkillsDir(): string {
  return mkdtempSync(join(tmpdir(), "skills-"));
}

function writeSkill(
  skillsDir: string,
  name: string,
  frontmatter: Record<string, string>,
): void {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\n${lines.join("\n")}\n---\n\n# ${name}\n\n본문 안내.\n`,
  );
}

const VALID: Record<string, string> = {
  name: "wchat-pptx",
  version: "1.0.0",
  description: "사내 표준 PPTX 템플릿을 생성하는 스킬입니다.",
  entryPoint: "skills/wchat-pptx/scripts/build.py",
};

describe("createSkillRegistry", () => {
  it("존재하지 않는 skills 디렉토리 → 빈 목록", async () => {
    const registry = createSkillRegistry({
      skillsDir: join(tmpdir(), "skills-never-exists-xyz"),
    });
    expect(await registry.list(SCOPE)).toEqual([]);
  });

  it("SKILL.md 파싱 → SkillSpec 생성 (id = name@version)", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "wchat-pptx", {
      ...VALID,
      triggers: "pptx 만들어줘, 발표자료",
      permissions: "user",
    });
    const registry = createSkillRegistry({ skillsDir });
    const list = await registry.list(SCOPE);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: "wchat-pptx@1.0.0",
      name: "wchat-pptx",
      version: "1.0.0",
      entryPoint: "skills/wchat-pptx/scripts/build.py",
      permissions: "user",
      triggers: ["pptx 만들어줘", "발표자료"],
    });
  });

  it("byId 로 단일 조회", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "wchat-pptx", VALID);
    const registry = createSkillRegistry({ skillsDir });
    expect(await registry.byId("wchat-pptx@1.0.0")).not.toBeNull();
    expect(await registry.byId("no-such@9.9.9")).toBeNull();
  });

  it("permissions 미지정 시 기본값 'user'", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "wchat-pptx", VALID);
    const registry = createSkillRegistry({ skillsDir });
    const list = await registry.list(SCOPE);
    expect(list[0].permissions).toBe("user");
  });

  it("_template 디렉토리는 스킬 목록에서 제외된다", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "_template", VALID);
    writeSkill(skillsDir, "wchat-pptx", VALID);
    const registry = createSkillRegistry({ skillsDir });
    const list = await registry.list(SCOPE);
    expect(list.map((s) => s.name)).toEqual(["wchat-pptx"]);
  });

  it("잘못된 semver 버전 → reject + 명확한 에러 (L09)", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "bad-version", {
      ...VALID,
      name: "bad-version",
      version: "v0.7",
    });
    expect(() => createSkillRegistry({ skillsDir })).toThrow(/semver/i);
  });

  it("description 이 20자 미만 → reject + 명확한 에러", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "short-desc", {
      ...VALID,
      name: "short-desc",
      description: "짧음",
    });
    expect(() => createSkillRegistry({ skillsDir })).toThrow(/description/i);
  });

  it("entryPoint 누락 → reject + 명확한 에러", async () => {
    const skillsDir = makeSkillsDir();
    const fields = { ...VALID };
    delete (fields as Record<string, string>).entryPoint;
    writeSkill(skillsDir, "no-entry", fields);
    expect(() => createSkillRegistry({ skillsDir })).toThrow(/entryPoint/i);
  });

  it("SKILL.md 자체가 없는 스킬 디렉토리 → reject + 명확한 에러", async () => {
    const skillsDir = makeSkillsDir();
    mkdirSync(join(skillsDir, "empty-dir"));
    expect(() => createSkillRegistry({ skillsDir })).toThrow(/SKILL\.md/);
  });

  it("scope=org 스킬은 orgId 일치할 때만 list 에 포함", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "org-skill", {
      ...VALID,
      name: "org-skill",
      scope: "org",
      orgId: "org-1",
    });
    const registry = createSkillRegistry({ skillsDir });
    expect(await registry.list(SCOPE)).toHaveLength(1);
    expect(
      await registry.list({
        orgId: "org-2",
        userId: "user-1",
        projectId: "proj-1",
      }),
    ).toHaveLength(0);
  });

  it("scope=user 스킬은 userId 일치할 때만 list 에 포함", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "user-skill", {
      ...VALID,
      name: "user-skill",
      scope: "user",
      userId: "user-1",
    });
    const registry = createSkillRegistry({ skillsDir });
    expect(await registry.list(SCOPE)).toHaveLength(1);
    expect(
      await registry.list({ orgId: "org-1", userId: "user-2" }),
    ).toHaveLength(0);
  });

  it("scope=project 스킬은 projectId 일치할 때만 list 에 포함", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "proj-skill", {
      ...VALID,
      name: "proj-skill",
      scope: "project",
      projectId: "proj-1",
    });
    const registry = createSkillRegistry({ skillsDir });
    expect(await registry.list(SCOPE)).toHaveLength(1);
    expect(
      await registry.list({ orgId: "org-1", userId: "user-1" }),
    ).toHaveLength(0);
    expect(
      await registry.list({
        orgId: "org-1",
        userId: "user-1",
        projectId: "proj-2",
      }),
    ).toHaveLength(0);
  });

  it("scope 미지정 시 기본값 global — 모든 scope 에 노출", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "wchat-pptx", VALID);
    const registry = createSkillRegistry({ skillsDir });
    expect(
      await registry.list({ orgId: "any-org", userId: "any-user" }),
    ).toHaveLength(1);
  });

  it("reload() 로 파일시스템 변경사항을 다시 읽는다", async () => {
    const skillsDir = makeSkillsDir();
    const registry = createSkillRegistry({ skillsDir });
    expect(await registry.list(SCOPE)).toEqual([]);

    writeSkill(skillsDir, "wchat-pptx", VALID);
    expect(await registry.list(SCOPE)).toEqual([]); // 캐시 — reload 전에는 반영 안 됨

    await registry.reload();
    expect(await registry.list(SCOPE)).toHaveLength(1);
  });

  it("잘못된 scope 값 → reject + 명확한 에러", async () => {
    const skillsDir = makeSkillsDir();
    writeSkill(skillsDir, "bad-scope", {
      ...VALID,
      name: "bad-scope",
      scope: "nonsense",
    });
    expect(() => createSkillRegistry({ skillsDir })).toThrow(/scope/i);
  });
});

describe("wchat-pptx 실제 스킬 (P8-T5-03, L09 semver·manifest 일관성 = lint-skills 대체)", () => {
  const skillDir = fileURLToPath(
    new URL("../../../../../skills/wchat-pptx", import.meta.url),
  );
  const skillsRootDir = fileURLToPath(
    new URL("../../../../../skills", import.meta.url),
  );

  it("SKILL.md 가 semver·description·entryPoint 검증을 통과하고 레지스트리에 로드된다", async () => {
    const registry = createSkillRegistry({ skillsDir: skillsRootDir });
    const spec = await registry.byId("wchat-pptx@1.0.0");
    expect(spec).not.toBeNull();
    expect(spec?.entryPoint).toBe("skills/wchat-pptx/scripts/build.mjs");
  });

  it("package.json 의 name/version 이 SKILL.md frontmatter 와 일치한다 (L09)", () => {
    const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const fm = skillMd.match(/^---\n([\s\S]+?)\n---/);
    const fields = Object.fromEntries(
      (fm?.[1] ?? "")
        .split("\n")
        .map((l) => l.split(/:\s*/, 2))
        .filter((p): p is [string, string] => p.length === 2),
    );
    const pkg = JSON.parse(
      readFileSync(join(skillDir, "package.json"), "utf8"),
    ) as { name: string; version: string };
    expect(pkg.name).toBe(fields.name);
    expect(pkg.version).toBe(fields.version);
  });

  it("CHANGELOG.md 최상단 항목이 SKILL.md version 과 일치한다 (L09)", () => {
    const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const version = skillMd.match(/^version:\s*(\S+)/m)?.[1];
    const changelog = readFileSync(join(skillDir, "CHANGELOG.md"), "utf8");
    expect(changelog).toContain(`[${version}]`);
  });
});

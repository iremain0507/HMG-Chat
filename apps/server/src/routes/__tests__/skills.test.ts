// skills.test.ts — P8-T5-02 RED: routes/skills.ts 가 createSkillRoutes 를 export 하지 않음.
// 16-API-CONTRACT § 11 — GET /skills(scope 필터) + GET /skills/:id/SKILL.md(원문).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createSkillRoutes } from "../skills.js";
import { createSkillRegistry } from "../../tools/skills-engine.js";

function writeSkill(
  skillsDir: string,
  name: string,
  frontmatter: Record<string, string>,
  body = "본문 안내.",
): void {
  const dir = join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  writeFileSync(
    join(dir, "SKILL.md"),
    `---\n${lines.join("\n")}\n---\n\n# ${name}\n\n${body}\n`,
  );
}

function appWith(skillsDir: string, orgId: string, userId: string) {
  const registry = createSkillRegistry({ skillsDir });
  const routes = createSkillRoutes({ registry, skillsDir });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: userId,
      org: orgId,
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

describe("createSkillRoutes", () => {
  it("GET / — global scope 스킬은 누구에게나 보인다", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "skills-routes-"));
    writeSkill(skillsDir, "wchat-pptx", {
      name: "wchat-pptx",
      version: "1.0.0",
      description: "사내 표준 PPTX 템플릿을 생성하는 스킬입니다.",
      entryPoint: "skills/wchat-pptx/scripts/build.py",
    });
    const app = appWith(skillsDir, randomUUID(), randomUUID());

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("wchat-pptx@1.0.0");
  });

  it("GET / — user scope 스킬은 소유자에게만 보인다", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "skills-routes-"));
    const userId = randomUUID();
    writeSkill(skillsDir, "private-skill", {
      name: "private-skill",
      version: "1.0.0",
      description: "이 사용자 전용 개인화 스킬 설명입니다.",
      entryPoint: "skills/private-skill/scripts/build.py",
      scope: "user",
      userId,
    });
    const mine = appWith(skillsDir, randomUUID(), userId);
    const resMine = await mine.request("/");
    expect(((await resMine.json()) as { data: unknown[] }).data).toHaveLength(
      1,
    );

    const other = appWith(skillsDir, randomUUID(), randomUUID());
    const resOther = await other.request("/");
    expect(((await resOther.json()) as { data: unknown[] }).data).toHaveLength(
      0,
    );
  });

  it("GET /:id/SKILL.md — 존재하는 스킬은 원문 markdown 을 반환한다", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "skills-routes-"));
    writeSkill(
      skillsDir,
      "wchat-pptx",
      {
        name: "wchat-pptx",
        version: "1.0.0",
        description: "사내 표준 PPTX 템플릿을 생성하는 스킬입니다.",
        entryPoint: "skills/wchat-pptx/scripts/build.py",
      },
      "이것은 본문입니다.",
    );
    const app = appWith(skillsDir, randomUUID(), randomUUID());

    const res = await app.request("/wchat-pptx@1.0.0/SKILL.md");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("이것은 본문입니다.");
  });

  it("GET /:id/SKILL.md — 존재하지 않는 id 는 404", async () => {
    const skillsDir = mkdtempSync(join(tmpdir(), "skills-routes-"));
    const app = appWith(skillsDir, randomUUID(), randomUUID());

    const res = await app.request("/no-such-skill@9.9.9/SKILL.md");
    expect(res.status).toBe(404);
  });
});

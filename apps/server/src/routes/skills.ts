// routes/skills.ts — 16-API-CONTRACT.md § 11 Skills 단일 출처.
// GET / — SkillRegistry.list(scope) 로 org/project/user scope 필터링된 목록.
// GET /:id/SKILL.md — 원문 markdown(등록된 skill 만, skillsDir 에서 직접 읽음 — SkillRegistry
// 는 파싱된 SkillSpec 만 노출하므로 raw 본문은 route 가 직접 fs 로 읽는다, skills-engine.ts 와
// 동일 경로 규칙: skillsDir/<spec.name>/SKILL.md).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { SkillRegistry } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createSkillRoutes(deps: {
  registry: SkillRegistry;
  skillsDir: string;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const projectId = c.req.query("projectId");
    const specs = await deps.registry.list({
      orgId: auth.org,
      userId: auth.sub,
      ...(projectId !== undefined ? { projectId } : {}),
    });
    return c.json({ data: specs, meta: { requestId: randomUUID() } });
  });

  app.get("/:id/SKILL.md", async (c) => {
    const spec = await deps.registry.byId(c.req.param("id"));
    if (!spec) {
      return c.json(errorJson("NOT_FOUND", "skill을 찾을 수 없습니다."), 404);
    }
    const path = join(deps.skillsDir, spec.name, "SKILL.md");
    if (!existsSync(path)) {
      return c.json(
        errorJson("NOT_FOUND", "SKILL.md를 찾을 수 없습니다."),
        404,
      );
    }
    return c.text(readFileSync(path, "utf8"), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });

  return app;
}

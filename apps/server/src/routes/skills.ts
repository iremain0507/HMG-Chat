// routes/skills.ts — 16-API-CONTRACT.md § 11 Skills 단일 출처.
// GET / — SkillRegistry.list(scope)(파일시스템 빌트인) + UserSkillStore(사용자 작성) 합본.
//   기본은 enabled 인 사용자 스킬만 — 즉 **주입 대상 목록**이다. 관리 화면은
//   ?includeDisabled=true 로 비활성 항목까지 받아 토글 UI 를 그린다.
// GET /:id/SKILL.md — 원문 markdown. 빌트인은 skillsDir 에서 직접 읽고(SkillRegistry 는 파싱된
//   SkillSpec 만 노출), 사용자 스킬은 DB 본문(user_skills.skill_md)을 그대로 돌려준다.
// POST / · PATCH /:id · DELETE /:id — P22-T6-18(계약 승인 C12). 사용자 작성 스킬 CRUD.
//   Open WebUI 의 Workspace > Tools/Functions 파리티(작성·활성화·삭제).
//
// 보안(승인서 필수 조건 — docs/rfc/P22-contract-batch.md § C12):
//   (1) permissions 는 frontmatter 값과 무관하게 항상 'user' 티어로 강제한다.
//   (2) entryPoint 는 샌드박스 내부 상대경로만 허용 — 절대경로/'..' 탈출/원격 스킴은 거부.
//   업로드된 entryPoint 는 기존 T1 샌드박스에서만 실행되며, 이 라우트는 저장 시점에
//   임의 스크립트 실행 경로가 열리지 않도록 선제 차단한다.
// 격리: user_skills RLS(0038)는 dev/test superuser role 이 우회하므로 org 경계는 이 라우트가
//   application 레벨에서 강제한다(routes/agents.ts 와 동일 — 남의 것은 403 아닌 404).
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type {
  SkillRegistry,
  SkillSpec,
  UserSkill,
  UserSkillStore,
} from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import { parseSkillMarkdown } from "../tools/skills-engine.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

/** 샌드박스 밖을 가리키는 entryPoint 차단 — 상대경로만 허용(§ 보안조건 2). */
function isSandboxRelativePath(entryPoint: string): boolean {
  if (entryPoint.trim() === "") return false;
  if (entryPoint.startsWith("/") || entryPoint.startsWith("\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entryPoint)) return false; // http:, file:, C: 등
  return !entryPoint.split(/[\\/]/).includes("..");
}

interface SkillDto extends SkillSpec {
  source: "builtin" | "user";
  enabled: boolean;
  skillId?: string; // 사용자 스킬의 저장소 PK(uuid). 빌트인은 없음.
}

function builtinDto(spec: SkillSpec): SkillDto {
  return { ...spec, source: "builtin", enabled: true };
}

/** 저장된 SKILL.md 를 파싱해 DTO 로. 파싱 실패(수동 DB 변조 등)한 행은 조용히 건너뛴다. */
function userDto(row: UserSkill): SkillDto | null {
  try {
    const spec = parseSkillMarkdown(row.skillMd, row.name);
    return {
      ...spec,
      permissions: "user", // 저장 시 강제했지만 읽기 경로에서도 재강제(방어적)
      source: "user",
      enabled: row.enabled,
      skillId: row.id,
    };
  } catch {
    return null;
  }
}

export function createSkillRoutes(deps: {
  registry: SkillRegistry;
  skillsDir: string;
  /** 미주입이면 사용자 작성 스킬 기능이 꺼진 상태로 동작(기존 읽기 전용 거동 유지). */
  userSkills?: UserSkillStore;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  /** 같은 org 의 것만 실재로 취급 — 아니면 null(=404, existence-leak 방지). */
  async function ownedByActor(
    actor: { orgId: string; userId: string },
    id: string,
  ): Promise<UserSkill | null> {
    if (!deps.userSkills) return null;
    const found = await deps.userSkills.byId(id);
    if (!found || found.orgId !== actor.orgId) return null;
    return found;
  }

  async function userSkillsOf(actor: {
    orgId: string;
    userId: string;
  }): Promise<UserSkill[]> {
    if (!deps.userSkills) return [];
    return deps.userSkills.list(actor);
  }

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const projectId = c.req.query("projectId");
    const includeDisabled = c.req.query("includeDisabled") === "true";

    const builtins = await deps.registry.list({
      orgId: actor.orgId,
      userId: actor.userId,
      ...(projectId !== undefined ? { projectId } : {}),
    });
    const mine = (await userSkillsOf(actor))
      .filter((row) => includeDisabled || row.enabled)
      .map(userDto)
      .filter((dto): dto is SkillDto => dto !== null);

    return c.json({
      data: [...builtins.map(builtinDto), ...mine],
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/", async (c) => {
    if (!deps.userSkills) {
      return c.json(
        errorJson("NOT_IMPLEMENTED", "스킬 작성이 활성화되지 않았습니다."),
        501,
      );
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.skillMd !== "string" || !body.skillMd.trim()) {
      return c.json(errorJson("INVALID_INPUT", "skillMd 가 필요합니다."), 400);
    }

    let spec: SkillSpec;
    try {
      spec = parseSkillMarkdown(body.skillMd, "user-skill");
    } catch (err) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          `SKILL.md 를 해석할 수 없습니다: ${(err as Error).message}`,
        ),
        400,
      );
    }
    if (!isSandboxRelativePath(spec.entryPoint)) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "entryPoint 는 샌드박스 내부 상대경로여야 합니다(절대경로·'..'·원격 스킴 불가).",
        ),
        400,
      );
    }

    const actor = actorOf(c);
    // UNIQUE (org_id, name, version) 을 DB 오류(500) 대신 계약상 409 로 선제 매핑.
    const existing = await deps.userSkills.list(actor);
    if (
      existing.some((r) => r.name === spec.name && r.version === spec.version)
    ) {
      return c.json(
        errorJson("CONFLICT", "같은 이름·버전의 스킬이 이미 있습니다."),
        409,
      );
    }

    const created = await deps.userSkills.create({
      orgId: actor.orgId,
      userId: actor.userId,
      name: spec.name,
      version: spec.version,
      skillMd: body.skillMd,
    });
    const dto = userDto(created);
    if (!dto) {
      return c.json(
        errorJson("INVALID_INPUT", "SKILL.md 를 해석할 수 없습니다."),
        400,
      );
    }
    return c.json({ data: dto, meta: { requestId: randomUUID() } }, 201);
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing || !deps.userSkills) {
      return c.json(errorJson("NOT_FOUND", "스킬을 찾을 수 없습니다."), 404);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }

    let current = existing;
    if (typeof body.skillMd === "string" && body.skillMd.trim()) {
      let spec: SkillSpec;
      try {
        spec = parseSkillMarkdown(body.skillMd, existing.name);
      } catch (err) {
        return c.json(
          errorJson(
            "INVALID_INPUT",
            `SKILL.md 를 해석할 수 없습니다: ${(err as Error).message}`,
          ),
          400,
        );
      }
      if (!isSandboxRelativePath(spec.entryPoint)) {
        return c.json(
          errorJson(
            "INVALID_INPUT",
            "entryPoint 는 샌드박스 내부 상대경로여야 합니다(절대경로·'..'·원격 스킴 불가).",
          ),
          400,
        );
      }
      current = await deps.userSkills.update(existing.id, {
        skillMd: body.skillMd,
        name: spec.name,
        version: spec.version,
      });
    }
    if (typeof body.enabled === "boolean") {
      await deps.userSkills.setEnabled(existing.id, body.enabled);
      current = { ...current, enabled: body.enabled };
    }

    const dto = userDto(current);
    if (!dto) {
      return c.json(
        errorJson("INVALID_INPUT", "SKILL.md 를 해석할 수 없습니다."),
        400,
      );
    }
    return c.json({ data: dto, meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor, c.req.param("id"));
    if (!existing || !deps.userSkills) {
      return c.json(errorJson("NOT_FOUND", "스킬을 찾을 수 없습니다."), 404);
    }
    await deps.userSkills.remove(existing.id);
    return c.body(null, 204);
  });

  app.get("/:id/SKILL.md", async (c) => {
    const actor = actorOf(c);
    const id = c.req.param("id");

    // 사용자 스킬 우선 — 본문은 DB 에 있고 skillsDir 에는 존재하지 않는다.
    const mine = (await userSkillsOf(actor)).find(
      (row) => `${row.name}@${row.version}` === id,
    );
    if (mine) {
      return c.text(mine.skillMd, 200, {
        "Content-Type": "text/markdown; charset=utf-8",
      });
    }

    const spec = await deps.registry.byId(id);
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

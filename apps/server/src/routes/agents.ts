// routes/agents.ts — 16-API-CONTRACT.md § Agents 단일 출처 (P22-T6-10, 계약 승인 C5).
// Open WebUI 의 Workspace > Models(커스텀 프리셋 = 기본 모델 + 시스템 프롬프트 + 도구/지식)
// 파리티. db/agent-data-access.ts 는 RLS 를 superuser role 로 우회하므로, org 경계와
// visibility(private=작성자만) 는 이 라우트가 application 레벨에서 강제한다
// (routes/mcp-servers.ts 와 동일 existence-leak 방지 패턴 — 없는 것처럼 404).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Agent } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { AgentDataAccess } from "../db/agent-data-access.js";

const VISIBILITIES = ["private", "org"] as const;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(agent: Agent) {
  return {
    id: agent.id,
    orgId: agent.orgId,
    name: agent.name,
    description: agent.description,
    baseModel: agent.baseModel,
    systemPrompt: agent.systemPrompt,
    toolIds: agent.toolIds,
    skillIds: agent.skillIds,
    projectIds: agent.projectIds,
    visibility: agent.visibility,
    createdBy: agent.createdBy,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

function isVisibility(v: unknown): v is Agent["visibility"] {
  return (
    typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v)
  );
}

/** 문자열 배열만 허용 — 그 외(숫자/객체 섞임)는 undefined 로 떨궈 400 으로 잡는다. */
function stringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string"))
    return undefined;
  return v as string[];
}

export function createAgentRoutes(deps: {
  da: AgentDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  /** 같은 org + (org 공개 또는 본인 소유) 인 것만 실재로 취급 — 아니면 null(=404). */
  async function visibleToActor(
    actor: { orgId: string; userId: string },
    id: string,
  ): Promise<Agent | null> {
    const found = await deps.da.agents.byId(id);
    if (!found || found.orgId !== actor.orgId) return null;
    if (found.visibility === "private" && found.createdBy !== actor.userId) {
      return null;
    }
    return found;
  }

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (typeof body.baseModel !== "string" || body.baseModel.trim() === "") {
      return c.json(
        errorJson("INVALID_INPUT", "baseModel 이 필요합니다."),
        400,
      );
    }
    if (body.visibility !== undefined && !isVisibility(body.visibility)) {
      return c.json(
        errorJson("INVALID_INPUT", "visibility 가 올바르지 않습니다."),
        400,
      );
    }
    const toolIds = stringArray(body.toolIds);
    const skillIds = stringArray(body.skillIds);
    const projectIds = stringArray(body.projectIds);
    if (
      (body.toolIds !== undefined && toolIds === undefined) ||
      (body.skillIds !== undefined && skillIds === undefined) ||
      (body.projectIds !== undefined && projectIds === undefined)
    ) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "toolIds/skillIds/projectIds 는 문자열 배열이어야 합니다.",
        ),
        400,
      );
    }

    const actor = actorOf(c);
    const name = body.name.trim();
    // UNIQUE (org_id, name) 를 DB 오류(500) 대신 계약상 409 로 선제 매핑.
    const existing = await deps.da.agents.list({ orgId: actor.orgId });
    if (existing.items.some((a) => a.name === name)) {
      return c.json(
        errorJson("CONFLICT", "같은 이름의 에이전트가 이미 있습니다."),
        409,
      );
    }

    const created = await deps.da.agents.insert({
      orgId: actor.orgId,
      name,
      description:
        typeof body.description === "string" ? body.description : null,
      baseModel: body.baseModel,
      systemPrompt:
        typeof body.systemPrompt === "string" ? body.systemPrompt : null,
      toolIds: toolIds ?? [],
      skillIds: skillIds ?? [],
      projectIds: projectIds ?? [],
      visibility: isVisibility(body.visibility) ? body.visibility : "private",
      createdBy: actor.userId,
    });
    return c.json(
      { data: toDto(created), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const page = await deps.da.agents.list({ orgId: actor.orgId });
    const visible = page.items.filter(
      (a) => a.visibility === "org" || a.createdBy === actor.userId,
    );
    return c.json({
      data: visible.map(toDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id", async (c) => {
    const actor = actorOf(c);
    const found = await visibleToActor(actor, c.req.param("id"));
    if (!found) {
      return c.json(
        errorJson("NOT_FOUND", "에이전트를 찾을 수 없습니다."),
        404,
      );
    }
    return c.json({ data: toDto(found), meta: { requestId: randomUUID() } });
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await visibleToActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "에이전트를 찾을 수 없습니다."),
        404,
      );
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (body.visibility !== undefined && !isVisibility(body.visibility)) {
      return c.json(
        errorJson("INVALID_INPUT", "visibility 가 올바르지 않습니다."),
        400,
      );
    }
    const patch: Partial<Agent> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") {
      patch.name = body.name.trim();
    }
    if (typeof body.description === "string" || body.description === null) {
      patch.description = body.description;
    }
    if (typeof body.baseModel === "string" && body.baseModel.trim() !== "") {
      patch.baseModel = body.baseModel;
    }
    if (typeof body.systemPrompt === "string" || body.systemPrompt === null) {
      patch.systemPrompt = body.systemPrompt;
    }
    for (const key of ["toolIds", "skillIds", "projectIds"] as const) {
      const parsed = stringArray(body[key]);
      if (body[key] !== undefined && parsed === undefined) {
        return c.json(
          errorJson("INVALID_INPUT", `${key} 는 문자열 배열이어야 합니다.`),
          400,
        );
      }
      if (parsed !== undefined) patch[key] = parsed;
    }
    if (isVisibility(body.visibility)) patch.visibility = body.visibility;

    if (patch.name !== undefined && patch.name !== existing.name) {
      const page = await deps.da.agents.list({ orgId: actor.orgId });
      if (
        page.items.some((a) => a.id !== existing.id && a.name === patch.name)
      ) {
        return c.json(
          errorJson("CONFLICT", "같은 이름의 에이전트가 이미 있습니다."),
          409,
        );
      }
    }

    const updated = await deps.da.agents.update(existing.id, patch);
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await visibleToActor(actor, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "에이전트를 찾을 수 없습니다."),
        404,
      );
    }
    await deps.da.agents.delete(existing.id);
    return c.body(null, 204);
  });

  return app;
}

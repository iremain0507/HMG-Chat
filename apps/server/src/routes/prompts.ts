// routes/prompts.ts — P19-T1-08: 프롬프트 라이브러리 CRUD(migration 0024 prompts 단일
// 출처). access='private' 는 owner 본인만, access='org' 는 같은 org 전원 조회 가능(수정/삭제는
// 항상 owner 본인만) — db/prompt-data-access.ts 의 listVisible/byIdVisible/updateForOwner/
// deleteForOwner 가 이중 조건(org_id + owner_id 또는 access)을 담당, 여기선 HTTP 계층만.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createPgPromptDataAccess,
  type Prompt,
  type PromptDataAccess,
} from "../db/prompt-data-access.js";
import type { ResourceGrantsDataAccess } from "../db/resource-grants-data-access.js";
import { filterAccessibleResourceIds } from "../lib/access-control.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toWire(prompt: Prompt) {
  return {
    id: prompt.id,
    command: prompt.command,
    title: prompt.title,
    content: prompt.content,
    access: prompt.access,
    ownerId: prompt.ownerId,
    createdAt: prompt.createdAt.toISOString(),
    updatedAt: prompt.updatedAt.toISOString(),
  };
}

function normalizeCommand(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isValidAccess(value: unknown): value is "private" | "org" {
  return value === "private" || value === "org";
}

interface PromptBody {
  command?: string;
  title?: string;
  content?: string;
  access?: string;
}

export interface PromptRoutesDeps {
  prompts?: PromptDataAccess;
  grants?: ResourceGrantsDataAccess;
}

export function createPromptRoutes(
  deps: PromptRoutesDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const prompts = deps.prompts ?? createPgPromptDataAccess();
  const grants = deps.grants;
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    const body = await c.req.json<PromptBody>().catch(() => ({}) as PromptBody);
    const command = body.command?.trim();
    const title = body.title?.trim();
    const content = body.content?.trim();
    const access = body.access ?? "private";
    if (!command || !title || !content) {
      return c.json(
        errorJson("INVALID_INPUT", "command, title, content 가 필요합니다."),
        400,
      );
    }
    if (!isValidAccess(access)) {
      return c.json(
        errorJson("INVALID_INPUT", "access 는 private 또는 org 여야 합니다."),
        400,
      );
    }
    try {
      const created = await prompts.create(auth.org, auth.sub, {
        command: normalizeCommand(command),
        title,
        content,
        access,
      });
      return c.json(
        { data: toWire(created), meta: { requestId: randomUUID() } },
        201,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate key") || message.includes("unique")) {
        return c.json(
          errorJson("CONFLICT", "이미 사용 중인 command 입니다."),
          409,
        );
      }
      throw err;
    }
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const list = await prompts.listVisible(auth.org, auth.sub);
    let visible = list;
    if (grants) {
      const accessible = await filterAccessibleResourceIds(grants, {
        orgId: auth.org,
        userId: auth.sub,
        resourceType: "prompt",
        resourceIds: list.map((p) => p.id),
        access: "read",
      });
      visible = list.filter((p) => accessible.has(p.id));
    }
    return c.json({
      data: visible.map(toWire),
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const prompt = await prompts.byIdVisible(auth.org, auth.sub, id);
    if (!prompt) {
      return c.json(
        errorJson("NOT_FOUND", "프롬프트를 찾을 수 없습니다."),
        404,
      );
    }
    if (grants) {
      const accessible = await filterAccessibleResourceIds(grants, {
        orgId: auth.org,
        userId: auth.sub,
        resourceType: "prompt",
        resourceIds: [prompt.id],
        access: "read",
      });
      if (!accessible.has(prompt.id)) {
        return c.json(
          errorJson("NOT_FOUND", "프롬프트를 찾을 수 없습니다."),
          404,
        );
      }
    }
    return c.json({ data: toWire(prompt), meta: { requestId: randomUUID() } });
  });

  app.patch("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const body = await c.req.json<PromptBody>().catch(() => ({}) as PromptBody);
    if (body.access !== undefined && !isValidAccess(body.access)) {
      return c.json(
        errorJson("INVALID_INPUT", "access 는 private 또는 org 여야 합니다."),
        400,
      );
    }
    try {
      const updated = await prompts.updateForOwner(auth.org, auth.sub, id, {
        command: body.command?.trim()
          ? normalizeCommand(body.command)
          : undefined,
        title: body.title?.trim(),
        content: body.content?.trim(),
        access: isValidAccess(body.access) ? body.access : undefined,
      });
      if (!updated) {
        return c.json(
          errorJson("NOT_FOUND", "프롬프트를 찾을 수 없습니다."),
          404,
        );
      }
      return c.json({
        data: toWire(updated),
        meta: { requestId: randomUUID() },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("duplicate key") || message.includes("unique")) {
        return c.json(
          errorJson("CONFLICT", "이미 사용 중인 command 입니다."),
          409,
        );
      }
      throw err;
    }
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const deleted = await prompts.deleteForOwner(auth.org, auth.sub, id);
    if (!deleted) {
      return c.json(
        errorJson("NOT_FOUND", "프롬프트를 찾을 수 없습니다."),
        404,
      );
    }
    return c.body(null, 204);
  });

  return app;
}

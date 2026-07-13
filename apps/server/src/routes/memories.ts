// routes/memories.ts — 16-API-CONTRACT.md § 9 Memories 단일 출처.
// db/user-memory-data-access.ts(T1, P7-T1-01) 는 RLS 를 superuser role 로 우회하므로,
// 소유자 격리(다른 유저의 memory 접근 차단)는 이 라우트가 application 레벨에서 강제한다
// (routes/uploads.ts, routes/artifact-shares.ts 와 동일 existence-leak 방지 패턴 — 404).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { UserMemory } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { UserMemoryDataAccess } from "../db/user-memory-data-access.js";

const CATEGORIES = ["user", "feedback", "project", "reference"] as const;

function isCategory(v: unknown): v is UserMemory["category"] {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(memory: UserMemory) {
  return {
    id: memory.id,
    userId: memory.userId,
    category: memory.category,
    content: memory.content,
    source: memory.source,
    sessionId: memory.sessionId,
    pinned: memory.pinned,
    metadata: memory.metadata,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

export function createMemoryRoutes(deps: {
  da: UserMemoryDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    return { userId: c.get("auth").sub };
  }

  async function ownedByActor(userId: string, id: string) {
    const found = await deps.da.userMemories.byId(id);
    return found && found.userId === userId ? found : null;
  }

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (
      !body ||
      typeof body.content !== "string" ||
      body.content.trim() === ""
    ) {
      return c.json(errorJson("INVALID_INPUT", "content 가 필요합니다."), 400);
    }
    if (!isCategory(body.category)) {
      return c.json(
        errorJson("INVALID_INPUT", "category 가 올바르지 않습니다."),
        400,
      );
    }
    const actor = actorOf(c);
    const memory = await deps.da.userMemories.insert({
      userId: actor.userId,
      category: body.category,
      content: body.content,
      source: "manual",
      sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
      pinned: typeof body.pinned === "boolean" ? body.pinned : false,
      metadata: null,
    });
    return c.json(
      { data: toDto(memory), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const categoryParam = c.req.query("category");
    if (categoryParam !== undefined && !isCategory(categoryParam)) {
      return c.json(
        errorJson("INVALID_INPUT", "category 가 올바르지 않습니다."),
        400,
      );
    }
    const pinnedParam = c.req.query("pinned");
    const limitParam = c.req.query("limit");
    const cursorParam = c.req.query("cursor");
    const page = await deps.da.userMemories.list(
      {
        userId: actor.userId,
        ...(categoryParam !== undefined ? { category: categoryParam } : {}),
        ...(pinnedParam !== undefined
          ? { pinned: pinnedParam === "true" }
          : {}),
      },
      {
        ...(cursorParam !== undefined ? { cursor: cursorParam } : {}),
        limit: limitParam ? Number.parseInt(limitParam, 10) : 50,
      },
    );
    return c.json({
      data: page.items.map(toDto),
      meta: { requestId: randomUUID(), nextCursor: page.nextCursor },
    });
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor.userId, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "memory 를 찾을 수 없습니다."), 404);
    }
    const body = await c.req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    if (body.category !== undefined && !isCategory(body.category)) {
      return c.json(
        errorJson("INVALID_INPUT", "category 가 올바르지 않습니다."),
        400,
      );
    }
    const patch: Partial<UserMemory> = {};
    if (isCategory(body.category)) patch.category = body.category;
    if (typeof body.content === "string") patch.content = body.content;
    if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
    const updated = await deps.da.userMemories.update(existing.id, patch);
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByActor(actor.userId, c.req.param("id"));
    if (!existing) {
      return c.json(errorJson("NOT_FOUND", "memory 를 찾을 수 없습니다."), 404);
    }
    await deps.da.userMemories.delete(existing.id);
    return c.body(null, 204);
  });

  return app;
}

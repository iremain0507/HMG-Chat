// memories.test.ts — P7-T2-03 RED: routes/memories.ts 가 createMemoryRoutes 를 export 하지 않음.
// 16-API-CONTRACT § 9 — POST/GET/PATCH/DELETE /memories 는 모두 actor 소유 UserMemory 만
// 조작 가능(다른 유저 memory 는 404, existence-leak 방지). pin 은 PATCH { pinned } 로 처리.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { UserMemory } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createMemoryRoutes } from "../memories.js";
import type { UserMemoryDataAccess } from "../../db/user-memory-data-access.js";

function makeDa(): UserMemoryDataAccess {
  const rows: UserMemory[] = [];
  return {
    userMemories: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as UserMemory;
        rows.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        rows[idx] = {
          ...rows[idx],
          ...data,
          updatedAt: new Date(),
        } as UserMemory;
        return rows[idx];
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (!filter?.userId || r.userId === filter.userId) &&
              (!filter?.category || r.category === filter.category) &&
              (filter?.pinned === undefined || r.pinned === filter.pinned),
          ),
        };
      },
      async pin(id, pinned) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows[idx] = { ...rows[idx], pinned };
      },
    },
  };
}

function appWith(da: UserMemoryDataAccess, userId: string) {
  const routes = createMemoryRoutes({ da });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: userId,
      org: randomUUID(),
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

let userId: string;
let otherUserId: string;

beforeEach(() => {
  userId = randomUUID();
  otherUserId = randomUUID();
});

describe("createMemoryRoutes", () => {
  it("POST / — 신규 memory 를 생성한다", async () => {
    const da = makeDa();
    const app = appWith(da, userId);

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "user", content: "취미: 등산" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: UserMemory };
    expect(body.data.userId).toBe(userId);
    expect(body.data.category).toBe("user");
    expect(body.data.source).toBe("manual");
    expect(body.data.pinned).toBe(false);
  });

  it("POST / — 잘못된 category 는 400 INVALID_INPUT", async () => {
    const da = makeDa();
    const app = appWith(da, userId);

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ category: "bogus", content: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("GET / — 본인 memory 만 목록 조회한다 (다른 유저 제외)", async () => {
    const da = makeDa();
    await da.userMemories.insert({
      userId,
      category: "user",
      content: "mine",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    await da.userMemories.insert({
      userId: otherUserId,
      category: "user",
      content: "theirs",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    const app = appWith(da, userId);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: UserMemory[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].content).toBe("mine");
  });

  it("PATCH /:id — pin 토글(pinned) 을 지원한다", async () => {
    const da = makeDa();
    const created = await da.userMemories.insert({
      userId,
      category: "feedback",
      content: "테스트는 real DB 로",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    const app = appWith(da, userId);

    const res = await app.request(`/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: UserMemory };
    expect(body.data.pinned).toBe(true);
  });

  it("PATCH /:id — 다른 유저의 memory 는 404 (existence-leak 방지)", async () => {
    const da = makeDa();
    const created = await da.userMemories.insert({
      userId: otherUserId,
      category: "user",
      content: "theirs",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    const app = appWith(da, userId);

    const res = await app.request(`/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: true }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — 소유자는 삭제한다", async () => {
    const da = makeDa();
    const created = await da.userMemories.insert({
      userId,
      category: "project",
      content: "삭제될 것",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    const app = appWith(da, userId);

    const res = await app.request(`/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await da.userMemories.byId(created.id)).toBeNull();
  });

  it("DELETE /:id — 다른 유저는 삭제할 수 없다 (404)", async () => {
    const da = makeDa();
    const created = await da.userMemories.insert({
      userId: otherUserId,
      category: "reference",
      content: "theirs",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    const app = appWith(da, userId);

    const res = await app.request(`/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await da.userMemories.byId(created.id)).not.toBeNull();
  });
});

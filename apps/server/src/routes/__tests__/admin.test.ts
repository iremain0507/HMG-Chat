// admin.test.ts — P9-T1-02 RED: routes/admin.ts 가 createAdminRoutes 를 export 안함.
// 16-API-CONTRACT § 14 — GET /admin/health/history 는 admin/owner 만, target 필수.
// P9-T1-07 RED: dashboard/users/tool-metrics 확장이 routes/admin.ts 에 없어(AdminDataAccess dep
// 미존재) 아래 신규 describe 블록이 타입 에러 + 404 로 실패 — dashboard/users/patch/suspend/
// unsuspend/tool-metrics 5 엔드포인트 + admin-only 가드 + org 격리를 검증.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { HealthCheckResult, User } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createAdminRoutes } from "../admin.js";
import type { HealthHistoryDataAccess } from "../../db/health-history-data-access.js";
import type { AdminDataAccess } from "../../db/admin-data-access.js";

function makeDa(seed: HealthCheckResult[] = []): HealthHistoryDataAccess {
  const rows = [...seed];
  return {
    healthHistory: {
      async append(entry) {
        rows.push(entry);
      },
      async recent(target, limit) {
        return rows.filter((r) => r.target === target).slice(0, limit);
      },
    },
  };
}

function makeUser(overrides: Partial<User> & { orgId: string }): User {
  return {
    id: randomUUID(),
    orgId: overrides.orgId,
    email: overrides.email ?? `user-${randomUUID()}@example.com`,
    name: overrides.name ?? null,
    role: overrides.role ?? "member",
    customInstructions: overrides.customInstructions ?? null,
    status: overrides.status ?? "active",
    lastLoginAt: overrides.lastLoginAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

function makeAdminDa(seedUsers: User[] = []): AdminDataAccess {
  const users = new Map(seedUsers.map((u) => [u.id, u]));
  return {
    async dashboardSummary(orgId) {
      const total = [...users.values()].filter((u) => u.orgId === orgId).length;
      return {
        users: { total, activeLast24h: 0, newLast7d: 0 },
        sessions: { total: 0, activeNow: 0, completedLast24h: 0 },
        errors: { last24h: 0, last7d: 0, critical: 0 },
        tools: { totalCalls24h: 0, errorRate: 0, p50LatencyMs: 0 },
      };
    },
    async listUsers(orgId, filter, limit) {
      let items = [...users.values()].filter((u) => u.orgId === orgId);
      if (filter.status)
        items = items.filter((u) => u.status === filter.status);
      if (filter.search) {
        items = items.filter((u) => u.email.includes(filter.search as string));
      }
      return items.slice(0, limit);
    },
    async patchUser(orgId, userId, patch) {
      const u = users.get(userId);
      if (!u || u.orgId !== orgId) return null;
      const updated = { ...u, ...patch };
      users.set(userId, updated);
      return updated;
    },
    async suspendUser(orgId, userId) {
      const u = users.get(userId);
      if (!u || u.orgId !== orgId) return null;
      users.set(userId, { ...u, status: "suspended" });
      return { sessionsRevoked: 2 };
    },
    async unsuspendUser(orgId, userId) {
      const u = users.get(userId);
      if (!u || u.orgId !== orgId) return false;
      users.set(userId, { ...u, status: "active" });
      return true;
    },
    async toolMetricsSummary() {
      return [
        {
          toolName: "bash",
          count: 10,
          errorCount: 1,
          errorRate: 0.1,
          p50DurationMs: 100,
          p95DurationMs: 200,
          p99DurationMs: 300,
          last24h: { count: 5, errorRate: 0 },
        },
      ];
    },
  };
}

function appWith(
  deps: { da: HealthHistoryDataAccess; adminDa: AdminDataAccess },
  actor: { userId: string; orgId: string; role: "member" | "admin" | "owner" },
) {
  const routes = createAdminRoutes(deps);
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role,
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

let userId: string;
let orgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
});

describe("createAdminRoutes", () => {
  it("GET /health/history — admin 은 target history 를 반환한다", async () => {
    const da = makeDa([
      { target: "db", status: "healthy", latencyMs: 12 },
      { target: "db", status: "degraded", latencyMs: 340 },
      { target: "redis", status: "healthy", latencyMs: 3 },
    ]);
    const app = appWith(
      { da, adminDa: makeAdminDa() },
      { userId, orgId, role: "admin" },
    );

    const res = await app.request("/health/history?target=db");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: HealthCheckResult[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r) => r.target === "db")).toBe(true);
  });

  it("GET /health/history — member 는 403", async () => {
    const da = makeDa([{ target: "db", status: "healthy", latencyMs: 12 }]);
    const app = appWith(
      { da, adminDa: makeAdminDa() },
      { userId, orgId, role: "member" },
    );

    const res = await app.request("/health/history?target=db");
    expect(res.status).toBe(403);
  });

  it("GET /health/history — target 없으면 400", async () => {
    const da = makeDa();
    const app = appWith(
      { da, adminDa: makeAdminDa() },
      { userId, orgId, role: "admin" },
    );

    const res = await app.request("/health/history");
    expect(res.status).toBe(400);
  });

  it("GET /dashboard — admin 은 요약을 반환한다", async () => {
    const users = [makeUser({ orgId }), makeUser({ orgId })];
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa(users) },
      { userId, orgId, role: "admin" },
    );

    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { users: { total: number } };
    };
    expect(body.data.users.total).toBe(2);
  });

  it("GET /dashboard — member 는 403", async () => {
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa() },
      { userId, orgId, role: "member" },
    );
    const res = await app.request("/dashboard");
    expect(res.status).toBe(403);
  });

  it("GET /users — admin 은 org 내 사용자 목록을 반환한다", async () => {
    const other = makeUser({ orgId: randomUUID() });
    const mine = makeUser({ orgId });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([other, mine]) },
      { userId, orgId, role: "admin" },
    );

    const res = await app.request("/users");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(mine.id);
  });

  it("GET /users — status 가 올바르지 않으면 400", async () => {
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa() },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request("/users?status=deleted");
    expect(res.status).toBe(400);
  });

  it("PATCH /users/:id — admin 은 role 을 변경한다", async () => {
    const target = makeUser({ orgId, role: "member" });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );

    const res = await app.request(`/users/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string } };
    expect(body.data.role).toBe("admin");
  });

  it("PATCH /users/:id — role/status 둘 다 없으면 400", async () => {
    const target = makeUser({ orgId });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /users/:id — 다른 org 사용자는 404 (cross-org 격리)", async () => {
    const target = makeUser({ orgId: randomUUID() });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(404);
  });

  it("PATCH /users/:id — member 는 403", async () => {
    const target = makeUser({ orgId });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "member" },
    );
    const res = await app.request(`/users/${target.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /users/:id/suspend — admin 은 reason 과 함께 suspend 한다", async () => {
    const target = makeUser({ orgId });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${target.id}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "abuse" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { ok: boolean; sessionsRevoked: number };
    };
    expect(body.data).toEqual({ ok: true, sessionsRevoked: 2 });
  });

  it("POST /users/:id/suspend — reason 없으면 400", async () => {
    const target = makeUser({ orgId });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${target.id}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("POST /users/:id/suspend — 존재하지 않는 사용자는 404", async () => {
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa() },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${randomUUID()}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "abuse" }),
    });
    expect(res.status).toBe(404);
  });

  it("POST /users/:id/unsuspend — admin 은 unsuspend 한다", async () => {
    const target = makeUser({ orgId, status: "suspended" });
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa([target]) },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request(`/users/${target.id}/unsuspend`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it("GET /tool-metrics — admin 은 도구별 통계를 반환한다", async () => {
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa() },
      { userId, orgId, role: "admin" },
    );
    const res = await app.request("/tool-metrics");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ toolName: string; errorRate: number }>;
    };
    expect(body.data[0]?.toolName).toBe("bash");
  });

  it("GET /tool-metrics — member 는 403", async () => {
    const app = appWith(
      { da: makeDa(), adminDa: makeAdminDa() },
      { userId, orgId, role: "member" },
    );
    const res = await app.request("/tool-metrics");
    expect(res.status).toBe(403);
  });
});

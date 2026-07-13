// admin.test.ts — P9-T1-02 RED: routes/admin.ts 가 createAdminRoutes 를 export 안함.
// 16-API-CONTRACT § 14 — GET /admin/health/history 는 admin/owner 만, target 필수.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { HealthCheckResult } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createAdminRoutes } from "../admin.js";
import type { HealthHistoryDataAccess } from "../../db/health-history-data-access.js";

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

function appWith(
  da: HealthHistoryDataAccess,
  actor: { userId: string; orgId: string; role: "member" | "admin" | "owner" },
) {
  const routes = createAdminRoutes({ da });
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
    const app = appWith(da, { userId, orgId, role: "admin" });

    const res = await app.request("/health/history?target=db");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: HealthCheckResult[] };
    expect(body.data).toHaveLength(2);
    expect(body.data.every((r) => r.target === "db")).toBe(true);
  });

  it("GET /health/history — member 는 403", async () => {
    const da = makeDa([{ target: "db", status: "healthy", latencyMs: 12 }]);
    const app = appWith(da, { userId, orgId, role: "member" });

    const res = await app.request("/health/history?target=db");
    expect(res.status).toBe(403);
  });

  it("GET /health/history — target 없으면 400", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId, role: "admin" });

    const res = await app.request("/health/history");
    expect(res.status).toBe(400);
  });
});

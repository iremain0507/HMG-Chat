// usage.test.ts — P9-T1-02 RED: routes/usage.ts 가 createUsageRoutes 를 export 안함.
// 16-API-CONTRACT § 12 — GET /usage/me 는 본인 usage 를 date 단위로 집계, GET /usage 는
// admin 전용(role !== admin/owner 면 403)이며 userId 포함 + org 경계 강제.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { UsageLogEntry } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createUsageRoutes } from "../usage.js";
import type { UsageLogDataAccess } from "../../db/usage-log-data-access.js";

function makeDa(seed: UsageLogEntry[] = []): UsageLogDataAccess {
  const rows = [...seed];
  return {
    usageLogs: {
      async append(entry) {
        rows.push(entry);
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (!filter.userId || r.userId === filter.userId) &&
              (!filter.orgId || r.orgId === filter.orgId) &&
              (!filter.fromDate || r.createdAt >= filter.fromDate) &&
              (!filter.toDate || r.createdAt <= filter.toDate),
          ),
        };
      },
      async aggregate(filter) {
        const items = rows.filter(
          (r) =>
            (!filter.userId || r.userId === filter.userId) &&
            (!filter.orgId || r.orgId === filter.orgId) &&
            r.createdAt >= filter.fromDate &&
            r.createdAt <= filter.toDate,
        );
        return {
          tokensIn: items.reduce((s, r) => s + r.tokensIn, 0),
          tokensOut: items.reduce((s, r) => s + r.tokensOut, 0),
          costMicros: items.reduce((s, r) => s + r.costMicros, 0),
        };
      },
    },
  };
}

function appWith(
  da: UsageLogDataAccess,
  actor: { userId: string; orgId: string; role?: "member" | "admin" | "owner" },
) {
  const routes = createUsageRoutes({ da });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role ?? "member",
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

describe("createUsageRoutes", () => {
  it("GET /me — 본인 usage 를 date 단위로 집계해 반환한다", async () => {
    const da = makeDa([
      {
        userId,
        orgId,
        sessionId: null,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokensIn: 100,
        tokensOut: 50,
        costMicros: 1000,
        createdAt: new Date("2026-07-10T01:00:00.000Z"),
      },
      {
        userId,
        orgId,
        sessionId: null,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokensIn: 200,
        tokensOut: 80,
        costMicros: 2000,
        createdAt: new Date("2026-07-10T05:00:00.000Z"),
      },
    ]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/me?from=2026-07-01&to=2026-07-31");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        date: string;
        tokensIn: number;
        tokensOut: number;
        costMicros: number;
      }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      date: "2026-07-10",
      tokensIn: 300,
      tokensOut: 130,
      costMicros: 3000,
    });
  });

  it("GET / — member 는 403", async () => {
    const da = makeDa([]);
    const app = appWith(da, { userId, orgId, role: "member" });

    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("GET / — admin 은 org 전체 usage 를 userId 포함해 반환한다", async () => {
    const otherUserId = randomUUID();
    const da = makeDa([
      {
        userId: otherUserId,
        orgId,
        sessionId: null,
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        tokensIn: 10,
        tokensOut: 5,
        costMicros: 100,
        createdAt: new Date("2026-07-12T00:00:00.000Z"),
      },
    ]);
    const app = appWith(da, { userId, orgId, role: "admin" });

    const res = await app.request("/?from=2026-07-01&to=2026-07-31");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ date: string; userId: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.userId).toBe(otherUserId);
  });
});

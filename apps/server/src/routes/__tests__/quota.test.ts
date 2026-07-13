// quota.test.ts — P9-T1-02 RED: routes/quota.ts 가 createQuotaRoutes 를 export 안함.
// 16-API-CONTRACT § 12 — GET /quota 는 본인 quota 만 반환, 레코드 없으면 404.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { UserQuotaInfo } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createQuotaRoutes } from "../quota.js";
import type { QuotaDataAccess } from "../../db/quota-data-access.js";

function makeDa(seed: UserQuotaInfo[] = []): QuotaDataAccess {
  const rows = [...seed];
  return {
    userQuotas: {
      async byUserId(userId) {
        return rows.find((r) => r.userId === userId) ?? null;
      },
      async upsert(info) {
        const idx = rows.findIndex((r) => r.userId === info.userId);
        if (idx === -1) rows.push(info);
        else rows[idx] = info;
        return info;
      },
      async consume(userId, micros) {
        const row = rows.find((r) => r.userId === userId);
        if (!row) throw new Error("not found");
        row.usedMicros += micros;
        return { remaining: row.budgetMicros - row.usedMicros };
      },
      async refund(userId, micros) {
        const row = rows.find((r) => r.userId === userId);
        if (row) row.usedMicros = Math.max(0, row.usedMicros - micros);
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) => !filter?.userId || r.userId === filter.userId,
          ),
        };
      },
    },
  };
}

function appWith(
  da: QuotaDataAccess,
  actor: { userId: string; orgId: string },
) {
  const routes = createQuotaRoutes({ da });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
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
let orgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
});

describe("createQuotaRoutes", () => {
  it("GET / — 본인 quota 를 반환한다", async () => {
    const periodEnd = new Date("2026-08-01T00:00:00.000Z");
    const da = makeDa([
      {
        userId,
        budgetMicros: 1_000_000,
        usedMicros: 200_000,
        periodStart: new Date("2026-07-01T00:00:00.000Z"),
        periodEnd,
      },
    ]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { budgetMicros: number; usedMicros: number; periodEnd: string };
    };
    expect(body.data.budgetMicros).toBe(1_000_000);
    expect(body.data.usedMicros).toBe(200_000);
    expect(body.data.periodEnd).toBe(periodEnd.toISOString());
  });

  it("GET / — quota 레코드가 없으면 404", async () => {
    const da = makeDa([]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/");
    expect(res.status).toBe(404);
  });

  it("GET / — 다른 유저의 quota 는 절대 반환하지 않는다", async () => {
    const otherUserId = randomUUID();
    const da = makeDa([
      {
        userId: otherUserId,
        budgetMicros: 1_000_000,
        usedMicros: 0,
        periodStart: new Date(),
        periodEnd: new Date(),
      },
    ]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/");
    expect(res.status).toBe(404);
  });
});

// errors.test.ts — P9-T1-02 RED: routes/errors.ts 가 createErrorRoutes 를 export 안함.
// 16-API-CONTRACT § 15 — POST /errors 는 level/category 검증 후 202, requestId? 는 optional.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { ErrorLogEntry } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createErrorRoutes } from "../errors.js";
import type { ErrorLogDataAccess } from "../../db/error-log-data-access.js";

function makeDa(): { da: ErrorLogDataAccess; rows: ErrorLogEntry[] } {
  const rows: ErrorLogEntry[] = [];
  return {
    rows,
    da: {
      errorLogs: {
        async append(entry) {
          rows.push(entry);
        },
        async list() {
          return { items: rows };
        },
      },
    },
  };
}

function appWith(
  da: ErrorLogDataAccess,
  actor: { userId: string; orgId: string },
) {
  const routes = createErrorRoutes({ da });
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

describe("createErrorRoutes", () => {
  it("POST / — 유효한 body 는 202 + errorLogs.append 호출", async () => {
    const { da, rows } = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: "error",
        category: "http",
        message: "요청 실패",
        context: { url: "/api/v1/x" },
        requestId: "req-1",
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { received: boolean } };
    expect(body.data.received).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe("요청 실패");
    expect(rows[0]?.userId).toBe(userId);
    expect(rows[0]?.orgId).toBe(orgId);
  });

  it("POST / — level 이 올바르지 않으면 400", async () => {
    const { da } = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: "not-a-level",
        category: "http",
        message: "x",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / — category 가 올바르지 않으면 400", async () => {
    const { da } = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        level: "error",
        category: "not-a-category",
        message: "x",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / — message 없으면 400", async () => {
    const { da } = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ level: "error", category: "http" }),
    });
    expect(res.status).toBe(400);
  });
});

// routes/admin.ts — 16-API-CONTRACT.md § 14 Health/Admin 단일 출처.
// GET /health/history: 14-INTERFACES.md HealthHistoryRepo.recent(target, limit) 이 유일한
// 조회 능력이라 query 는 target(필수)+limit(선택)만 지원 — from/to 필터는 repo 계약에 없어 미구현.
// GET /dashboard, GET /users, PATCH /users/:id, POST /users/:id/{suspend,unsuspend},
// GET /tool-metrics: db/admin-data-access.ts(AdminDataAccess) 단일 출처, org 범위로 격리.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { User } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { HealthHistoryDataAccess } from "../db/health-history-data-access.js";
import type { AdminDataAccess } from "../db/admin-data-access.js";

const DEFAULT_LIMIT = 50;
const MAX_USER_LIMIT = 100;
const DEFAULT_TOOL_METRICS_RANGE_DAYS = 7;
const USER_ROLES: readonly User["role"][] = ["member", "admin", "owner"];
const PATCHABLE_STATUSES: readonly User["status"][] = ["active", "suspended"];

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "owner";
}

function userDto(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    orgId: u.orgId,
    role: u.role,
    status: u.status,
    lastLoginAt: u.lastLoginAt,
  };
}

function parseDateRange(c: {
  req: { query(key: string): string | undefined };
}) {
  const fromParam = c.req.query("from");
  const toParam = c.req.query("to");
  const toDate = toParam ? new Date(toParam) : new Date();
  const fromDate = fromParam
    ? new Date(fromParam)
    : new Date(
        toDate.getTime() -
          DEFAULT_TOOL_METRICS_RANGE_DAYS * 24 * 60 * 60 * 1000,
      );
  return { fromDate, toDate };
}

export function createAdminRoutes(deps: {
  da: HealthHistoryDataAccess;
  adminDa: AdminDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/health/history", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const target = c.req.query("target");
    if (!target) {
      return c.json(errorJson("INVALID_INPUT", "target 이 필요합니다."), 400);
    }
    const limitParam = c.req.query("limit");
    const limit = limitParam ? Number(limitParam) : DEFAULT_LIMIT;
    const items = await deps.da.healthHistory.recent(target, limit);
    return c.json({
      data: items,
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/dashboard", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const data = await deps.adminDa.dashboardSummary(auth.org);
    return c.json({ data, meta: { requestId: randomUUID() } });
  });

  app.get("/users", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const status = c.req.query("status");
    if (status && !PATCHABLE_STATUSES.includes(status as User["status"])) {
      return c.json(
        errorJson("INVALID_INPUT", "status 가 올바르지 않습니다."),
        400,
      );
    }
    const limitParam = c.req.query("limit");
    const limit = limitParam
      ? Math.min(Number(limitParam), MAX_USER_LIMIT)
      : DEFAULT_LIMIT;
    const search = c.req.query("search");
    const items = await deps.adminDa.listUsers(
      auth.org,
      {
        ...(search ? { search } : {}),
        ...(status ? { status: status as User["status"] } : {}),
      },
      limit,
    );
    return c.json({
      data: items.map(userDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.patch("/users/:id", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const role = body?.role;
    const status = body?.status;
    if (role === undefined && status === undefined) {
      return c.json(
        errorJson("INVALID_INPUT", "role 또는 status 가 필요합니다."),
        400,
      );
    }
    if (role !== undefined && !USER_ROLES.includes(role)) {
      return c.json(
        errorJson("INVALID_INPUT", "role 이 올바르지 않습니다."),
        400,
      );
    }
    if (status !== undefined && !PATCHABLE_STATUSES.includes(status)) {
      return c.json(
        errorJson("INVALID_INPUT", "status 가 올바르지 않습니다."),
        400,
      );
    }
    const updated = await deps.adminDa.patchUser(auth.org, c.req.param("id"), {
      ...(role !== undefined ? { role } : {}),
      ...(status !== undefined ? { status } : {}),
    });
    if (!updated) {
      return c.json(errorJson("NOT_FOUND", "사용자를 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: userDto(updated),
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/users/:id/suspend", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.reason !== "string" || body.reason.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "reason 이 필요합니다."), 400);
    }
    const result = await deps.adminDa.suspendUser(auth.org, c.req.param("id"));
    if (!result) {
      return c.json(errorJson("NOT_FOUND", "사용자를 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: { ok: true, sessionsRevoked: result.sessionsRevoked },
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/users/:id/unsuspend", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const ok = await deps.adminDa.unsuspendUser(auth.org, c.req.param("id"));
    if (!ok) {
      return c.json(errorJson("NOT_FOUND", "사용자를 찾을 수 없습니다."), 404);
    }
    return c.json({ data: { ok: true }, meta: { requestId: randomUUID() } });
  });

  app.get("/tool-metrics", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const { fromDate, toDate } = parseDateRange(c);
    const data = await deps.adminDa.toolMetricsSummary(
      auth.org,
      fromDate,
      toDate,
    );
    return c.json({ data, meta: { requestId: randomUUID() } });
  });

  return app;
}

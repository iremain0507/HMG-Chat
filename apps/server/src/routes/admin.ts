// routes/admin.ts — 16-API-CONTRACT.md § 14 GET /admin/health/history 단일 출처.
// 14-INTERFACES.md HealthHistoryRepo.recent(target, limit) 이 유일한 조회 능력이라
// query 는 target(필수)+limit(선택)만 지원 — from/to 필터는 repo 계약에 없어 미구현.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { HealthHistoryDataAccess } from "../db/health-history-data-access.js";

const DEFAULT_LIMIT = 50;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createAdminRoutes(deps: {
  da: HealthHistoryDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/health/history", async (c) => {
    const auth = c.get("auth");
    if (auth.role !== "admin" && auth.role !== "owner") {
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

  return app;
}

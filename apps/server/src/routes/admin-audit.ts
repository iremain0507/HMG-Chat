// routes/admin-audit.ts — P20-T1-16: audit_log(migration 0031) 조회 라우트.
// GET /api/v1/admin/audit-logs — org-scoped, admin 전용, action 필터 + cursor 페이지네이션
// (sessions.ts GET / 와 동일 cursor/limit 컨벤션). orgId 는 auth(JWT)에서만 파생 — body/query
// 로 받지 않아 cross-org 불가.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { AuditLogDataAccess } from "../db/audit-log-data-access.js";

const MAX_LIMIT = 100;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "owner";
}

function parseLimit(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, MAX_LIMIT);
}

export interface AdminAuditRouteDeps {
  da: AuditLogDataAccess;
}

export function createAdminAuditRoutes(
  deps: AdminAuditRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const action = c.req.query("action");
    const cursor = c.req.query("cursor");
    const limit = parseLimit(c.req.query("limit"));
    const page = await deps.da.list(auth.org, {
      ...(action ? { action } : {}),
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit } : {}),
    });
    return c.json({
      data: page.items.map((item) => ({
        id: item.id,
        actorUserId: item.actorUserId,
        action: item.action,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        metadata: item.metadata,
        createdAt: item.createdAt.toISOString(),
      })),
      meta: {
        requestId: randomUUID(),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      },
    });
  });

  return app;
}

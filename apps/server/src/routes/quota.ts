// routes/quota.ts — 16-API-CONTRACT.md § 12 GET /quota 단일 출처.
// db/quota-data-access.ts(T1, P9-T1-02) 는 RLS 를 superuser role 로 우회하므로,
// 본인 quota 만 조회 가능하도록 이 라우트가 application 레벨에서 강제한다.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { QuotaDataAccess } from "../db/quota-data-access.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createQuotaRoutes(deps: {
  da: QuotaDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const userId = c.get("auth").sub;
    const quota = await deps.da.userQuotas.byUserId(userId);
    if (!quota) {
      return c.json(errorJson("NOT_FOUND", "quota 를 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: {
        budgetMicros: quota.budgetMicros,
        usedMicros: quota.usedMicros,
        periodEnd: quota.periodEnd.toISOString(),
      },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

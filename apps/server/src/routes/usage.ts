// routes/usage.ts — 16-API-CONTRACT.md § 12 GET /usage/me, GET /usage 단일 출처.
// db/usage-log-data-access.ts(T1, P9-T1-02)는 UsageLogRepo.list 로 원시 row 를 반환하므로
// 이 라우트가 date(YYYY-MM-DD) 단위로 집계해 계약 응답 형태로 변환한다.
// GET /me 는 같은 원시 row 를 model 단위로도 집계해 byModel(costMicros 내림차순)로 함께 반환한다
// (계약단위 C17(A), P22-T6-19). data 배열 형태는 하위호환 유지 — byModel 은 순수 추가 필드.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { UsageLogEntry } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { UsageLogDataAccess } from "../db/usage-log-data-access.js";

const DEFAULT_RANGE_DAYS = 30;
const MAX_ENTRIES = 100;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
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
    : new Date(toDate.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
}

function dayOf(entry: UsageLogEntry): string {
  return entry.createdAt.toISOString().slice(0, 10);
}

export function createUsageRoutes(deps: {
  da: UsageLogDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/me", async (c) => {
    const auth = c.get("auth");
    const { fromDate, toDate } = parseDateRange(c);
    const page = await deps.da.usageLogs.list(
      { userId: auth.sub, fromDate, toDate },
      { limit: MAX_ENTRIES },
    );
    const byDate = new Map<
      string,
      { date: string; tokensIn: number; tokensOut: number; costMicros: number }
    >();
    for (const entry of page.items) {
      const date = dayOf(entry);
      const bucket = byDate.get(date) ?? {
        date,
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
      };
      bucket.tokensIn += entry.tokensIn;
      bucket.tokensOut += entry.tokensOut;
      bucket.costMicros += entry.costMicros;
      byDate.set(date, bucket);
    }
    const byModel = new Map<
      string,
      { model: string; tokensIn: number; tokensOut: number; costMicros: number }
    >();
    for (const entry of page.items) {
      const bucket = byModel.get(entry.model) ?? {
        model: entry.model,
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
      };
      bucket.tokensIn += entry.tokensIn;
      bucket.tokensOut += entry.tokensOut;
      bucket.costMicros += entry.costMicros;
      byModel.set(entry.model, bucket);
    }
    return c.json({
      data: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
      byModel: [...byModel.values()].sort(
        (a, b) => b.costMicros - a.costMicros,
      ),
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (auth.role !== "admin" && auth.role !== "owner") {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const { fromDate, toDate } = parseDateRange(c);
    const page = await deps.da.usageLogs.list(
      { orgId: auth.org, fromDate, toDate },
      { limit: MAX_ENTRIES },
    );
    const byKey = new Map<
      string,
      {
        date: string;
        userId: string;
        tokensIn: number;
        tokensOut: number;
        costMicros: number;
      }
    >();
    for (const entry of page.items) {
      const date = dayOf(entry);
      const key = `${date}:${entry.userId}`;
      const bucket = byKey.get(key) ?? {
        date,
        userId: entry.userId,
        tokensIn: 0,
        tokensOut: 0,
        costMicros: 0,
      };
      bucket.tokensIn += entry.tokensIn;
      bucket.tokensOut += entry.tokensOut;
      bucket.costMicros += entry.costMicros;
      byKey.set(key, bucket);
    }
    return c.json({
      data: [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date)),
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

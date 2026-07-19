// routes/admin-analytics.ts — P20-T1-15: OWUI 대비 Analytics 갭.
// usage_logs(0010)+messages(0002) 는 있으나 모델별 랭킹/시간대별 메시지량 뷰가 없었다.
// GET /api/v1/admin/analytics: (a) 모델별 messages/tokens/cost 랭킹(usage_logs 집계),
// (b) 시간 버킷(일/시)별 메시지 카운트(messages 집계). org 는 auth 에서만 파생(cross-org 불가),
// groupId 는 db/group-data-access.ts 재사용 대상인 group_members(0026) 로 사용자 범위를 좁힌다.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";

export interface ModelUsageRanking {
  model: string;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
}

export interface MessageTimelineBucket {
  bucket: string;
  count: number;
}

export type AnalyticsBucket = "day" | "hour";

export interface AdminAnalyticsDataAccess {
  modelUsageRanking(
    orgId: string,
    from: Date,
    to: Date,
    groupId?: string,
  ): Promise<ModelUsageRanking[]>;
  messageTimeline(
    orgId: string,
    from: Date,
    to: Date,
    bucket: AnalyticsBucket,
    groupId?: string,
  ): Promise<MessageTimelineBucket[]>;
}

const DEFAULT_RANGE_DAYS = 30;
const BUCKETS: readonly AnalyticsBucket[] = ["day", "hour"];

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "owner";
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

export interface AdminAnalyticsRouteDeps {
  analyticsDa: AdminAnalyticsDataAccess;
}

export function createAdminAnalyticsRoutes(
  deps: AdminAnalyticsRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const bucketParam = c.req.query("bucket") ?? "day";
    if (!BUCKETS.includes(bucketParam as AnalyticsBucket)) {
      return c.json(
        errorJson("INVALID_INPUT", "bucket 은 day 또는 hour 여야 합니다."),
        400,
      );
    }
    const bucket = bucketParam as AnalyticsBucket;
    const groupId = c.req.query("groupId") || undefined;
    const { fromDate, toDate } = parseDateRange(c);

    const [modelUsage, timeline] = await Promise.all([
      deps.analyticsDa.modelUsageRanking(auth.org, fromDate, toDate, groupId),
      deps.analyticsDa.messageTimeline(
        auth.org,
        fromDate,
        toDate,
        bucket,
        groupId,
      ),
    ]);

    return c.json({
      data: { modelUsage, timeline },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

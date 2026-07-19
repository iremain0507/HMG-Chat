// admin-analytics.test.ts — P20-T1-15 RED: routes/admin-analytics.ts 가 존재하지 않아
// createAdminAnalyticsRoutes import 가 실패한다(타입 에러 + 실행 실패).
// 16-API-CONTRACT 신규: GET /api/v1/admin/analytics — 모델별 사용량 랭킹 + 메시지 타임라인.
// admin/owner 전용(403 가드), org 는 auth 에서만 파생(query 로 cross-org 불가).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import {
  createAdminAnalyticsRoutes,
  type AdminAnalyticsDataAccess,
  type ModelUsageRanking,
  type MessageTimelineBucket,
} from "../admin-analytics.js";

function makeDa(
  modelUsage: ModelUsageRanking[] = [],
  timeline: MessageTimelineBucket[] = [],
): AdminAnalyticsDataAccess & {
  calls: Array<{ orgId: string; groupId?: string }>;
} {
  const calls: Array<{ orgId: string; groupId?: string }> = [];
  return {
    calls,
    async modelUsageRanking(orgId, _from, _to, groupId) {
      calls.push({ orgId, groupId });
      return modelUsage;
    },
    async messageTimeline(orgId, _from, _to, _bucket, groupId) {
      calls.push({ orgId, groupId });
      return timeline;
    },
  };
}

function appWith(da: AdminAnalyticsDataAccess, role: string, org: string) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: randomUUID(),
      org,
      role,
      email: "x@example.com",
    } as AuthedVariables["auth"]);
    await next();
  });
  app.route("/", createAdminAnalyticsRoutes({ analyticsDa: da }));
  return app;
}

describe("createAdminAnalyticsRoutes — GET /", () => {
  it("member 는 403", async () => {
    const app = appWith(makeDa(), "member", randomUUID());
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("admin 은 modelUsage/timeline 을 반환한다", async () => {
    const org = randomUUID();
    const da = makeDa(
      [
        {
          model: "gpt-4o",
          messages: 10,
          tokensIn: 1000,
          tokensOut: 500,
          costMicros: 12000,
        },
      ],
      [{ bucket: "2026-07-01T00:00:00.000Z", count: 3 }],
    );
    const app = appWith(da, "admin", org);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        modelUsage: ModelUsageRanking[];
        timeline: MessageTimelineBucket[];
      };
    };
    expect(body.data.modelUsage[0]?.model).toBe("gpt-4o");
    expect(body.data.timeline[0]?.count).toBe(3);
    expect(da.calls.every((c) => c.orgId === org)).toBe(true);
  });

  it("bucket 이 day/hour 가 아니면 400", async () => {
    const app = appWith(makeDa(), "admin", randomUUID());
    const res = await app.request("/?bucket=week");
    expect(res.status).toBe(400);
  });

  it("groupId 쿼리를 data access 에 그대로 전달한다", async () => {
    const org = randomUUID();
    const groupId = randomUUID();
    const da = makeDa();
    const app = appWith(da, "admin", org);
    await app.request(`/?groupId=${groupId}`);
    expect(da.calls.some((c) => c.groupId === groupId)).toBe(true);
  });
});

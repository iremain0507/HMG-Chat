// admin-analytics-composition.test.ts — P20-T1-15 acceptance: routes/admin-analytics.ts 가
// app.ts 에 실제 mount 돼 있는지 + admin 전용(member 403) + cross-org 격리(다른 org
// usage_logs/messages 미노출) + 집계 정확성(모델별 messages/tokens/cost, 시간 버킷 카운트) +
// groupId 필터(group_members) + 빈 인덱스(L2, 데이터 없는 org 는 빈 배열) 를 실 HTTP + 실
// Postgres 로 검증.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { signAccessToken } from "../../middleware/jwt.js";

process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
process.env.PROJECT_SLUG = "wchat";

const TEST_ENV: Env = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgres://wchat:localdev@localhost:5432/wchat_dev",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  JWT_SECRET: process.env.JWT_SECRET,
  ALLOWED_DOMAINS: "example.com",
  EMAIL_SENDER_KIND: "test",
};

describe("app.ts /api/v1/admin/analytics mount — P20-T1-15", () => {
  const org = {
    id: randomUUID(),
    domain: `org-analytics-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-analytics-other-${randomUUID()}.example.com`,
  };
  const emptyOrg = {
    id: randomUUID(),
    domain: `org-analytics-empty-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-analytics-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-analytics-${randomUUID()}@${org.domain}`,
  };
  const groupedUser = {
    id: randomUUID(),
    email: `grouped-analytics-${randomUUID()}@${org.domain}`,
  };
  const otherOrgUser = {
    id: randomUUID(),
    email: `other-analytics-${randomUUID()}@${otherOrg.domain}`,
  };
  const emptyOrgAdmin = {
    id: randomUUID(),
    email: `emptyadmin-analytics-${randomUUID()}@${emptyOrg.domain}`,
  };
  const groupId = randomUUID();
  const session = { id: randomUUID() };
  const otherOrgSession = { id: randomUUID() };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Analytics', $2), ($3, 'Org Analytics Other', $4), ($5, 'Org Analytics Empty', $6)",
      [
        org.id,
        org.domain,
        otherOrg.id,
        otherOrg.domain,
        emptyOrg.id,
        emptyOrg.domain,
      ],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'admin'), ($4, $2, $5, 'member'), ($6, $2, $7, 'member')`,
      [
        admin.id,
        org.id,
        admin.email,
        member.id,
        member.email,
        groupedUser.id,
        groupedUser.email,
      ],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'member')",
      [otherOrgUser.id, otherOrg.id, otherOrgUser.email],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [emptyOrgAdmin.id, emptyOrg.id, emptyOrgAdmin.email],
    );
    await pgPool.query(
      "INSERT INTO groups (id, org_id, name) VALUES ($1, $2, 'Analytics Test Group')",
      [groupId, org.id],
    );
    await pgPool.query(
      "INSERT INTO group_members (group_id, user_id, org_id) VALUES ($1, $2, $3)",
      [groupId, groupedUser.id, org.id],
    );
    await pgPool.query(
      `INSERT INTO usage_logs (user_id, org_id, provider, model, tokens_in, tokens_out, cost_micros) VALUES
         ($1, $2, 'openai', 'gpt-4o', 100, 50, 1200),
         ($1, $2, 'openai', 'gpt-4o', 200, 80, 1500),
         ($4, $2, 'openai', 'gpt-4o-mini', 30, 10, 100),
         ($5, $3, 'openai', 'gpt-4o', 999, 999, 9999)`,
      [member.id, org.id, otherOrg.id, groupedUser.id, otherOrgUser.id],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id) VALUES ($1, $2), ($3, $4)",
      [session.id, member.id, otherOrgSession.id, otherOrgUser.id],
    );
    await pgPool.query(
      `INSERT INTO messages (session_id, role, content) VALUES
         ($1, 'user', '{}'), ($1, 'assistant', '{}'), ($1, 'user', '{}'),
         ($2, 'user', '{}')`,
      [session.id, otherOrgSession.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM messages WHERE session_id = ANY($1)", [
      [session.id, otherOrgSession.id],
    ]);
    await pgPool.query("DELETE FROM sessions WHERE id = ANY($1)", [
      [session.id, otherOrgSession.id],
    ]);
    await pgPool.query("DELETE FROM usage_logs WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM group_members WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM groups WHERE id = $1", [groupId]);
    await pgPool.query("DELETE FROM users WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id, emptyOrg.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [org.id, otherOrg.id, emptyOrg.id],
    ]);
  });

  function cookieFor(user: {
    id: string;
    orgId?: string;
    role?: "member" | "admin" | "owner";
  }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: user.orgId ?? org.id,
      role: user.role ?? "admin",
    });
    return `${cookieName}=${token}`;
  }

  it("미인증 GET /api/v1/admin/analytics → 401", async () => {
    const res = await app.request("/api/v1/admin/analytics");
    expect(res.status).toBe(401);
  });

  it("member 는 403", async () => {
    const res = await app.request("/api/v1/admin/analytics", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(res.status).toBe(403);
  });

  it("admin: 모델별 랭킹(합산) + 시간 버킷 메시지 카운트, 다른 org 데이터 미노출", async () => {
    const res = await app.request(
      "/api/v1/admin/analytics?from=2020-01-01&bucket=day",
      { headers: { Cookie: cookieFor(admin) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        modelUsage: Array<{
          model: string;
          messages: number;
          tokensIn: number;
          tokensOut: number;
          costMicros: number;
        }>;
        timeline: Array<{ bucket: string; count: number }>;
      };
    };
    const gpt4o = body.data.modelUsage.find((m) => m.model === "gpt-4o");
    expect(gpt4o?.messages).toBe(2);
    expect(gpt4o?.tokensIn).toBe(300);
    expect(gpt4o?.tokensOut).toBe(130);
    expect(gpt4o?.costMicros).toBe(2700);
    expect(gpt4o?.messages).not.toBe(3);

    const mini = body.data.modelUsage.find((m) => m.model === "gpt-4o-mini");
    expect(mini?.messages).toBe(1);

    const totalTimelineCount = body.data.timeline.reduce(
      (sum, b) => sum + b.count,
      0,
    );
    expect(totalTimelineCount).toBe(3);
  });

  it("groupId 필터: 그룹 멤버(groupedUser) 사용량만 반환", async () => {
    const res = await app.request(
      `/api/v1/admin/analytics?from=2020-01-01&groupId=${groupId}`,
      { headers: { Cookie: cookieFor(admin) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { modelUsage: Array<{ model: string; messages: number }> };
    };
    expect(body.data.modelUsage).toHaveLength(1);
    expect(body.data.modelUsage[0]?.model).toBe("gpt-4o-mini");
  });

  it("bucket=week → 400", async () => {
    const res = await app.request("/api/v1/admin/analytics?bucket=week", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(400);
  });

  it("L2: 데이터 없는 org 는 빈 배열(무데이터여도 500 아님)", async () => {
    const res = await app.request("/api/v1/admin/analytics?from=2020-01-01", {
      headers: {
        Cookie: cookieFor({
          id: emptyOrgAdmin.id,
          orgId: emptyOrg.id,
          role: "admin",
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { modelUsage: unknown[]; timeline: unknown[] };
    };
    expect(body.data.modelUsage).toEqual([]);
    expect(body.data.timeline).toEqual([]);
  });
});

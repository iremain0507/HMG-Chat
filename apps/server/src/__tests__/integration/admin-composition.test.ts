// admin-composition.test.ts — P9-T1-07 acceptance: routes/admin.ts 의 dashboard/users/
// tool-metrics 확장이 app.ts 에 실제 mount 돼 있는지 + admin role 만 접근 가능한지(비admin 403)
// + cross-org 격리(다른 org 사용자는 404)를 실 HTTP + 실 Postgres 레벨에서 검증.
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
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

describe("app.ts /api/v1/admin/{dashboard,users,tool-metrics} mount — P9-T1-07", () => {
  const org = {
    id: randomUUID(),
    domain: `org-adc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-adc-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-adc-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-adc-${randomUUID()}@${org.domain}`,
  };
  const target = {
    id: randomUUID(),
    email: `target-adc-${randomUUID()}@${org.domain}`,
  };
  const otherOrgUser = {
    id: randomUUID(),
    email: `other-adc-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ADC', $2), ($3, 'Org ADC Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
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
        target.id,
        target.email,
      ],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'member')",
      [otherOrgUser.id, otherOrg.id, otherOrgUser.email],
    );
    await pgPool.query(
      `INSERT INTO tool_metrics (tool_name, status, duration_ms, user_id, org_id) VALUES
         ('bash', 'ok', 120, $1, $2), ('bash', 'error', 340, $1, $2)`,
      [member.id, org.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM tool_metrics WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM users WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [org.id, otherOrg.id],
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

  it("미인증 GET /api/v1/admin/dashboard → 401", async () => {
    const res = await app.request("/api/v1/admin/dashboard");
    expect(res.status).toBe(401);
  });

  it("member 는 dashboard/users/tool-metrics 모두 403", async () => {
    const dashboardRes = await app.request("/api/v1/admin/dashboard", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(dashboardRes.status).toBe(403);

    const usersRes = await app.request("/api/v1/admin/users", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(usersRes.status).toBe(403);

    const metricsRes = await app.request("/api/v1/admin/tool-metrics", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(metricsRes.status).toBe(403);
  });

  it("admin GET /api/v1/admin/dashboard → org 사용자 수 요약", async () => {
    const res = await app.request("/api/v1/admin/dashboard", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { users: { total: number } } };
    expect(body.data.users.total).toBe(3);
  });

  it("admin GET /api/v1/admin/users → org 내 사용자만 반환 (다른 org 제외)", async () => {
    const res = await app.request("/api/v1/admin/users", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((u) => u.id);
    expect(ids).toContain(target.id);
    expect(ids).not.toContain(otherOrgUser.id);
  });

  it("admin PATCH /api/v1/admin/users/:id → role 변경, 다른 org 사용자는 404", async () => {
    const okRes = await app.request(`/api/v1/admin/users/${target.id}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(okRes.status).toBe(200);
    const okBody = (await okRes.json()) as { data: { role: string } };
    expect(okBody.data.role).toBe("admin");

    const crossOrgRes = await app.request(
      `/api/v1/admin/users/${otherOrgUser.id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(admin),
        },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(crossOrgRes.status).toBe(404);
  });

  it("admin POST suspend → unsuspend 플로우 (실 users.status 반영)", async () => {
    const suspendRes = await app.request(
      `/api/v1/admin/users/${target.id}/suspend`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(admin),
        },
        body: JSON.stringify({ reason: "abuse" }),
      },
    );
    expect(suspendRes.status).toBe(200);

    const afterSuspend = await pgPool.query(
      "SELECT status FROM users WHERE id = $1",
      [target.id],
    );
    expect(afterSuspend.rows[0]?.status).toBe("suspended");

    const unsuspendRes = await app.request(
      `/api/v1/admin/users/${target.id}/unsuspend`,
      { method: "POST", headers: { Cookie: cookieFor(admin) } },
    );
    expect(unsuspendRes.status).toBe(200);

    const afterUnsuspend = await pgPool.query(
      "SELECT status FROM users WHERE id = $1",
      [target.id],
    );
    expect(afterUnsuspend.rows[0]?.status).toBe("active");
  });

  it("admin GET /api/v1/admin/tool-metrics → 도구별 집계 반환", async () => {
    const res = await app.request("/api/v1/admin/tool-metrics", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ toolName: string; count: number; errorCount: number }>;
    };
    const bash = body.data.find((m) => m.toolName === "bash");
    expect(bash?.count).toBe(2);
    expect(bash?.errorCount).toBe(1);
  });
});

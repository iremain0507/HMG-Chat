// admin-audit-composition.test.ts — P20-T1-16 acceptance: admin mutation(PUT /admin/settings 등)이
// audit_log(migration 0031)에 실제로 행을 남기는지 + GET /api/v1/admin/audit-logs 가 app.ts 에
// mount 돼 admin 전용으로 org-scoped 조회되는지(cross-org 격리 포함)를 실 HTTP + 실 Postgres 로 검증.
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

describe("app.ts /api/v1/admin/audit-logs 마운트 + admin mutation 기록 — P20-T1-16", () => {
  const org = {
    id: randomUUID(),
    domain: `org-aac-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-aac-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-aac-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-aac-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `other-admin-aac-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AAC', $2), ($3, 'Org AAC Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'admin'), ($4, $2, $5, 'member'), ($6, $7, $8, 'admin')`,
      [
        admin.id,
        org.id,
        admin.email,
        member.id,
        member.email,
        otherOrgAdmin.id,
        otherOrg.id,
        otherOrgAdmin.email,
      ],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM audit_log WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM org_settings WHERE org_id = ANY($1)", [
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

  it("미인증 GET /api/v1/admin/audit-logs → 401", async () => {
    const res = await app.request("/api/v1/admin/audit-logs");
    expect(res.status).toBe(401);
  });

  it("member GET /api/v1/admin/audit-logs → 403", async () => {
    const res = await app.request("/api/v1/admin/audit-logs", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(res.status).toBe(403);
  });

  it("admin 설정 PUT 후 audit_log 에 실제로 행이 남는다(DB 직접 단언)", async () => {
    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ maxTokens: 9000 }),
    });
    expect(putRes.status).toBe(200);

    const rows = await pgPool.query(
      `SELECT action, actor_user_id, resource_type, resource_id, metadata
       FROM audit_log WHERE org_id = $1 AND action = 'admin.settings.updated'
       ORDER BY created_at DESC LIMIT 1`,
      [org.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].actor_user_id).toBe(admin.id);
    expect(rows.rows[0].resource_type).toBe("org_settings");
  });

  it("GET /api/v1/admin/audit-logs 가 방금 기록된 행을 {data,meta} 엔벨로프로 반환한다", async () => {
    const res = await app.request("/api/v1/admin/audit-logs", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ action: string; resourceType: string | null }>;
      meta: { requestId: string };
    };
    expect(typeof body.meta.requestId).toBe("string");
    expect(
      body.data.some((row) => row.action === "admin.settings.updated"),
    ).toBe(true);
  });

  it("action 필터로 특정 이벤트만 조회한다", async () => {
    const res = await app.request(
      "/api/v1/admin/audit-logs?action=admin.settings.updated",
      { headers: { Cookie: cookieFor(admin) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ action: string }>;
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(
      body.data.every((row) => row.action === "admin.settings.updated"),
    ).toBe(true);
  });

  it("cross-org: org B admin 은 org A 의 audit_log 를 조회할 수 없다", async () => {
    const res = await app.request("/api/v1/admin/audit-logs", {
      headers: { Cookie: cookieFor(otherOrgAdmin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ action: string }> };
    expect(
      body.data.some((row) => row.action === "admin.settings.updated"),
    ).toBe(false);
  });
});

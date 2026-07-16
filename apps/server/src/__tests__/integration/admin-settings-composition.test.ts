// admin-settings-composition.test.ts — P14-T1-05 acceptance: routes/admin-settings.ts 의
// GET/PUT /api/v1/admin/settings 가 app.ts 에 실제 mount 돼 있는지 + admin role 만 접근 가능한지
// (비admin 403) + 잘못된 body(400) + PUT 후 GET 반영 + cross-org 격리를 실 HTTP + 실 Postgres 로 검증.
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

describe("app.ts /api/v1/admin/settings mount — P14-T1-05", () => {
  const org = {
    id: randomUUID(),
    domain: `org-asc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-asc-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-asc-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-asc-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `other-admin-asc-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ASC', $2), ($3, 'Org ASC Other', $4)",
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

  it("미인증 GET /api/v1/admin/settings → 401", async () => {
    const res = await app.request("/api/v1/admin/settings");
    expect(res.status).toBe(401);
  });

  it("member GET/PUT /api/v1/admin/settings → 403", async () => {
    const getRes = await app.request("/api/v1/admin/settings", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(getRes.status).toBe(403);

    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ id: member.id, role: "member" }),
      },
      body: JSON.stringify({ maxTokens: 8192 }),
    });
    expect(putRes.status).toBe(403);
  });

  it("admin GET /api/v1/admin/settings → 기본값 {data,meta} 엔벨로프", async () => {
    const res = await app.request("/api/v1/admin/settings", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { maxTokens: number };
      meta: { requestId: string };
    };
    expect(body.data.maxTokens).toBe(4096);
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("admin PUT 잘못된 body(범위 밖 maxTokens) → 400 + issues", async () => {
    const res = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ maxTokens: -1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("admin PUT 후 GET 이 변경을 반영한다", async () => {
    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ maxTokens: 8192, temperature: 0.2 }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { data: { maxTokens: number } };
    expect(putBody.data.maxTokens).toBe(8192);

    const getRes = await app.request("/api/v1/admin/settings", {
      headers: { Cookie: cookieFor(admin) },
    });
    const getBody = (await getRes.json()) as {
      data: { maxTokens: number; temperature: number };
    };
    expect(getBody.data.maxTokens).toBe(8192);
    expect(getBody.data.temperature).toBe(0.2);
  });

  it("org A PUT 이 org B 설정에 영향을 주지 않는다 (orgId 는 서버가 auth 에서만 파생)", async () => {
    await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ maxTokens: 12000 }),
    });

    const otherRes = await app.request("/api/v1/admin/settings", {
      headers: { Cookie: cookieFor(otherOrgAdmin) },
    });
    expect(otherRes.status).toBe(200);
    const otherBody = (await otherRes.json()) as {
      data: { maxTokens: number };
    };
    expect(otherBody.data.maxTokens).toBe(4096);
  });
});

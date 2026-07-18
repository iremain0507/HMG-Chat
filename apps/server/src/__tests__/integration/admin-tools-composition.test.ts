// admin-tools-composition.test.ts — P22-T6-02 acceptance: routes/admin-tools.ts 의
// GET/PUT /api/v1/admin/tools 가 app.ts 에 실제 mount 돼 있는지 + admin role 만 접근 가능한지
// (비admin 403) + 잘못된 body(400) + PUT 후 GET 반영(organizations.allowed_tools 재사용) +
// cross-org 격리를 실 HTTP + 실 Postgres 로 검증. allowedModels(admin-models) 패턴을 그대로 반영.
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

describe("app.ts /api/v1/admin/tools mount — P22-T6-02", () => {
  const org = {
    id: randomUUID(),
    domain: `org-atc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-atc-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-atc-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-atc-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `other-admin-atc-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ATC', $2), ($3, 'Org ATC Other', $4)",
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

  it("미인증 GET /api/v1/admin/tools → 401", async () => {
    const res = await app.request("/api/v1/admin/tools");
    expect(res.status).toBe(401);
  });

  it("member GET/PUT /api/v1/admin/tools → 403", async () => {
    const getRes = await app.request("/api/v1/admin/tools", {
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(getRes.status).toBe(403);

    const putRes = await app.request("/api/v1/admin/tools", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ id: member.id, role: "member" }),
      },
      body: JSON.stringify({ allowedTools: ["web_search"] }),
    });
    expect(putRes.status).toBe(403);
  });

  it("admin GET /api/v1/admin/tools → 기본값 빈 배열 {data,meta} 엔벨로프", async () => {
    const res = await app.request("/api/v1/admin/tools", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { allowedTools: string[] };
      meta: { requestId: string };
    };
    expect(body.data.allowedTools).toEqual([]);
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("admin PUT 잘못된 body(문자열 배열 아님) → 400 INVALID_INPUT", async () => {
    const res = await app.request("/api/v1/admin/tools", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ allowedTools: [1, 2] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("admin PUT 후 GET 이 변경을 반영한다 (organizations.allowed_tools 재사용)", async () => {
    const putRes = await app.request("/api/v1/admin/tools", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({
        allowedTools: ["web_search", "code_interpreter"],
      }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as {
      data: { allowedTools: string[] };
    };
    expect(putBody.data.allowedTools).toEqual([
      "web_search",
      "code_interpreter",
    ]);

    const getRes = await app.request("/api/v1/admin/tools", {
      headers: { Cookie: cookieFor(admin) },
    });
    const getBody = (await getRes.json()) as {
      data: { allowedTools: string[] };
    };
    expect(getBody.data.allowedTools).toEqual([
      "web_search",
      "code_interpreter",
    ]);
  });

  it("org A PUT 이 org B allowedTools 에 영향을 주지 않는다 (orgId 는 서버가 auth 에서만 파생)", async () => {
    await app.request("/api/v1/admin/tools", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ allowedTools: ["web_search"] }),
    });

    const otherRes = await app.request("/api/v1/admin/tools", {
      headers: { Cookie: cookieFor(otherOrgAdmin) },
    });
    expect(otherRes.status).toBe(200);
    const otherBody = (await otherRes.json()) as {
      data: { allowedTools: string[] };
    };
    expect(otherBody.data.allowedTools).toEqual([]);
  });
});

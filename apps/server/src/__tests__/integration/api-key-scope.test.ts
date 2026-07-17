// api-key-scope.test.ts — P20-T1-12 acceptance: auth-middleware.ts Bearer 경로가 API 키
// scopes 를 실제로 강제하는지(빈 scopes=하위호환 전권, scopes 존재 시 범위 밖 요청 403) +
// org_settings.enableApiKeys 마스터 토글이 비활성 org 의 키 발급을 거부하는지 실 HTTP + 실
// Postgres 로 검증한다. 현재(구현 전) auth-middleware 는 scope 를 전혀 검사하지 않아 scoped
// 키로도 전권이 부여되고(RED #1), enableApiKeys 필드 자체가 없어 off 로 설정할 방법이 없다
// (RED #2).
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

describe("auth-middleware Bearer scope enforcement + enableApiKeys 게이트 — P20-T1-12", () => {
  const org = {
    id: randomUUID(),
    domain: `org-aks-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-aks-${randomUUID()}@${org.domain}`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-aks-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AKS', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'member'), ($4, $2, $5, 'admin')`,
      [owner.id, org.id, owner.email, admin.id, admin.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM api_keys WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM users WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function cookieFor(user: { id: string; role: "member" | "admin" }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: user.role,
    });
    return `${cookieName}=${token}`;
  }

  async function createKey(name: string, scopes: string[]): Promise<string> {
    const res = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ id: owner.id, role: "member" }),
      },
      body: JSON.stringify({ name, scopes }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { key: string } };
    return body.data.key;
  }

  it("빈 scopes 키는 하위호환으로 전권 — GET /api/v1/sessions 200", async () => {
    const rawKey = await createKey("full-access-key", []);
    const res = await app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status).toBe(200);
  });

  it("scopes=[chat:read] 키로 GET /api/v1/sessions(범위 내) → 200", async () => {
    const rawKey = await createKey("chat-read-key", ["chat:read"]);
    const res = await app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(res.status).toBe(200);
  });

  it("scopes=[chat:read] 키로 POST /api/v1/prompts(범위 밖) → 403", async () => {
    const rawKey = await createKey("chat-read-only-key", ["chat:read"]);
    const res = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${rawKey}`,
      },
      body: JSON.stringify({
        command: "/x",
        title: "x",
        content: "x",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("enableApiKeys=false org 에서 POST /api/v1/api-keys → 403(발급 거부)", async () => {
    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ id: admin.id, role: "admin" }),
      },
      body: JSON.stringify({ enableApiKeys: false }),
    });
    expect(putRes.status).toBe(200);

    try {
      const res = await app.request("/api/v1/api-keys", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor({ id: owner.id, role: "member" }),
        },
        body: JSON.stringify({ name: "should-be-blocked" }),
      });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("FORBIDDEN");
    } finally {
      await app.request("/api/v1/admin/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor({ id: admin.id, role: "admin" }),
        },
        body: JSON.stringify({ enableApiKeys: true }),
      });
    }
  });
});

// api-keys-composition.test.ts — P19-T1-11 acceptance: routes/api-keys.ts 의
// POST/GET/DELETE /api/v1/api-keys 가 app.ts 에 실제 mount 돼 있는지 + 평문 키 1회 노출/목록
// 마스킹/폐기 + Authorization: Bearer <key> 가 쿠키 JWT 를 대체해 보호 라우트 인증을 통과하는지
// (폐기 후 401) + self-service 격리(cross-org/cross-user 차단)를 실 HTTP + 실 Postgres 로 검증.
// 마이그레이션은 이 테스트 실행 전 test-database globalSetup 이 재적용한다(0025_api_keys).
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

describe("app.ts /api/v1/api-keys mount — P19-T1-11", () => {
  const org = {
    id: randomUUID(),
    domain: `org-akc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-akc-other-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-akc-${randomUUID()}@${org.domain}`,
  };
  const otherUser = {
    id: randomUUID(),
    email: `member-akc-${randomUUID()}@${org.domain}`,
  };
  const otherOrgUser = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `member-akc-other-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AKC', $2), ($3, 'Org AKC Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'member'), ($4, $2, $5, 'member'), ($6, $7, $8, 'member')`,
      [
        owner.id,
        org.id,
        owner.email,
        otherUser.id,
        otherUser.email,
        otherOrgUser.id,
        otherOrg.id,
        otherOrgUser.email,
      ],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM api_keys WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM users WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
  });

  function cookieFor(user: { id: string; orgId?: string }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: user.orgId ?? org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  it("미인증 GET /api/v1/api-keys → 401", async () => {
    const res = await app.request("/api/v1/api-keys");
    expect(res.status).toBe(401);
  });

  it("name 없는 POST → 400 INVALID_INPUT", async () => {
    const res = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(owner),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("발급(평문 1회)→목록 마스킹→Bearer 인증 통과→폐기 후 401", async () => {
    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(owner),
      },
      body: JSON.stringify({ name: "ci-key" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      data: { id: string; key: string; keyPrefix: string };
    };
    const rawKey = createBody.data.key;
    expect(typeof rawKey).toBe("string");
    expect(rawKey.startsWith(createBody.data.keyPrefix)).toBe(true);

    const listRes = await app.request("/api/v1/api-keys", {
      headers: { Cookie: cookieFor(owner) },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.key).toBeUndefined();
    expect(listBody.data[0]?.keyPrefix).toBe(createBody.data.keyPrefix);

    const protectedRes = await app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(protectedRes.status).toBe(200);

    const revokeRes = await app.request(
      `/api/v1/api-keys/${createBody.data.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(owner) },
      },
    );
    expect(revokeRes.status).toBe(204);

    const afterRevokeRes = await app.request("/api/v1/sessions", {
      headers: { Authorization: `Bearer ${rawKey}` },
    });
    expect(afterRevokeRes.status).toBe(401);
  });

  it("잘못된 Bearer 키 → 401", async () => {
    const res = await app.request("/api/v1/sessions", {
      headers: { Authorization: "Bearer not-a-real-key" },
    });
    expect(res.status).toBe(401);
  });

  it("cross-user: 다른 사용자는 목록에서 남의 키를 보지 못하고 폐기도 못 한다", async () => {
    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(owner),
      },
      body: JSON.stringify({ name: "owner-only-key" }),
    });
    const createBody = (await createRes.json()) as { data: { id: string } };

    const otherListRes = await app.request("/api/v1/api-keys", {
      headers: { Cookie: cookieFor(otherUser) },
    });
    const otherListBody = (await otherListRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(otherListBody.data.some((k) => k.id === createBody.data.id)).toBe(
      false,
    );

    const otherRevokeRes = await app.request(
      `/api/v1/api-keys/${createBody.data.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(otherUser) },
      },
    );
    expect(otherRevokeRes.status).toBe(404);
  });

  it("cross-org: 다른 org 사용자는 목록에서 안 보이고 폐기도 못 한다", async () => {
    const createRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(owner),
      },
      body: JSON.stringify({ name: "org-scoped-key" }),
    });
    const createBody = (await createRes.json()) as { data: { id: string } };

    const otherOrgListRes = await app.request("/api/v1/api-keys", {
      headers: { Cookie: cookieFor(otherOrgUser) },
    });
    const otherOrgListBody = (await otherOrgListRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(otherOrgListBody.data.some((k) => k.id === createBody.data.id)).toBe(
      false,
    );

    const otherOrgRevokeRes = await app.request(
      `/api/v1/api-keys/${createBody.data.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(otherOrgUser) },
      },
    );
    expect(otherOrgRevokeRes.status).toBe(404);
  });
});

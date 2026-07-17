// admin-users-delete-composition.test.ts — P20-T1-13 acceptance: DELETE /api/v1/admin/users/:id
// 가 app.ts 에 실제 mount 돼 있는지 + primary owner(org 최고령 owner)/마지막 owner/자기 자신
// 삭제 가드가 실 Postgres 상태를 바꾸지 않는지(soft-delete 는 users.status='deleted')를
// 실 HTTP + 실 Postgres 레벨에서 검증한다. 마이그레이션은 이 테스트 실행 전
// `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
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

describe("app.ts DELETE /api/v1/admin/users/:id 마운트 — P20-T1-13", () => {
  const org = {
    id: randomUUID(),
    domain: `org-aud-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-aud-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-aud-${randomUUID()}@${org.domain}`,
  };
  const ownerA = {
    id: randomUUID(),
    email: `ownera-aud-${randomUUID()}@${org.domain}`,
  };
  const ownerB = {
    id: randomUUID(),
    email: `ownerb-aud-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-aud-${randomUUID()}@${org.domain}`,
  };
  const otherOrgUser = {
    id: randomUUID(),
    email: `other-aud-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AUD', $2), ($3, 'Org AUD Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role, created_at) VALUES
         ($1, $2, $3, 'admin', NOW()),
         ($4, $2, $5, 'owner', NOW() - INTERVAL '2 hours'),
         ($6, $2, $7, 'owner', NOW() - INTERVAL '1 hour'),
         ($8, $2, $9, 'member', NOW())`,
      [
        admin.id,
        org.id,
        admin.email,
        ownerA.id,
        ownerA.email,
        ownerB.id,
        ownerB.email,
        member.id,
        member.email,
      ],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'member')",
      [otherOrgUser.id, otherOrg.id, otherOrgUser.email],
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

  it("미인증 DELETE → 401", async () => {
    const res = await app.request(`/api/v1/admin/users/${member.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("member 는 403", async () => {
    const res = await app.request(`/api/v1/admin/users/${member.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
    });
    expect(res.status).toBe(403);
  });

  it("admin 이 일반 member 삭제 → 200, 실제 status='deleted' 반영 + GET /users 목록에서 제외", async () => {
    const res = await app.request(`/api/v1/admin/users/${member.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(200);

    const row = await pgPool.query("SELECT status FROM users WHERE id = $1", [
      member.id,
    ]);
    expect(row.rows[0]?.status).toBe("deleted");

    const listRes = await app.request("/api/v1/admin/users", {
      headers: { Cookie: cookieFor(admin) },
    });
    const body = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((u) => u.id)).not.toContain(member.id);
  });

  it("org 최고령 owner(primary admin) 삭제 → 409 거부, DB 행 유지(status active)", async () => {
    const res = await app.request(`/api/v1/admin/users/${ownerA.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(409);

    const row = await pgPool.query("SELECT status FROM users WHERE id = $1", [
      ownerA.id,
    ]);
    expect(row.rows[0]?.status).toBe("active");
  });

  it("org 의 마지막 owner 삭제 → 409 거부(other owner 먼저 삭제 후 단일 owner 상태)", async () => {
    const preDeleteOwnerB = await app.request(
      `/api/v1/admin/users/${ownerB.id}`,
      { method: "DELETE", headers: { Cookie: cookieFor(admin) } },
    );
    expect(preDeleteOwnerB.status).toBe(200);

    const res = await app.request(`/api/v1/admin/users/${ownerA.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(409);

    const row = await pgPool.query("SELECT status FROM users WHERE id = $1", [
      ownerA.id,
    ]);
    expect(row.rows[0]?.status).toBe("active");
  });

  it("자기 자신 삭제 → 403", async () => {
    const res = await app.request(`/api/v1/admin/users/${admin.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(403);
  });

  it("다른 org 사용자 삭제 시도 → 404 (cross-org 격리)", async () => {
    const res = await app.request(`/api/v1/admin/users/${otherOrgUser.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(res.status).toBe(404);

    const row = await pgPool.query("SELECT status FROM users WHERE id = $1", [
      otherOrgUser.id,
    ]);
    expect(row.rows[0]?.status).toBe("active");
  });
});

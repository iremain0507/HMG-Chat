// admin-groups-composition.test.ts — P19-T1-13 acceptance: routes/admin-groups.ts 의
// CRUD(/api/v1/admin/groups) + 멤버 추가/제거가 app.ts 에 실제 mount 돼 있는지 + isAdmin 403
// 게이트 + cross-org 차단을 실 HTTP + 실 Postgres 로 검증. 마이그레이션은 이 테스트 실행 전
// test-database globalSetup 이 재적용한다(0026_groups).
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

describe("app.ts /api/v1/admin/groups mount — P19-T1-13", () => {
  const org = {
    id: randomUUID(),
    domain: `org-agc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-agc-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-agc-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-agc-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `admin-agc-other-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AGC', $2), ($3, 'Org AGC Other', $4)",
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
    await pgPool.query("DELETE FROM group_members WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM groups WHERE org_id = ANY($1)", [
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
    role?: string;
  }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: user.orgId ?? org.id,
      role: user.role ?? "admin",
    });
    return `${cookieName}=${token}`;
  }

  it("미인증 GET /api/v1/admin/groups → 401", async () => {
    const res = await app.request("/api/v1/admin/groups");
    expect(res.status).toBe(401);
  });

  it("비admin POST → 403 FORBIDDEN", async () => {
    const res = await app.request("/api/v1/admin/groups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ ...member, role: "member" }),
      },
      body: JSON.stringify({ name: "engineers" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("name 없는 POST → 400 INVALID_INPUT", async () => {
    const res = await app.request("/api/v1/admin/groups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("생성→목록→이름변경→멤버 추가/제거→삭제 전체 흐름", async () => {
    const createRes = await app.request("/api/v1/admin/groups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ name: "engineers" }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      data: { id: string; name: string; memberUserIds: string[] };
    };
    expect(createBody.data.name).toBe("engineers");
    expect(createBody.data.memberUserIds).toEqual([]);
    const groupId = createBody.data.id;

    const listRes = await app.request("/api/v1/admin/groups", {
      headers: { Cookie: cookieFor(admin) },
    });
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(listBody.data.some((g) => g.id === groupId)).toBe(true);

    const renameRes = await app.request(`/api/v1/admin/groups/${groupId}`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ name: "engineering" }),
    });
    expect(renameRes.status).toBe(200);
    const renameBody = (await renameRes.json()) as { data: { name: string } };
    expect(renameBody.data.name).toBe("engineering");

    const addMemberRes = await app.request(
      `/api/v1/admin/groups/${groupId}/members`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(admin),
        },
        body: JSON.stringify({ userId: member.id }),
      },
    );
    expect(addMemberRes.status).toBe(204);

    const afterAddRes = await app.request("/api/v1/admin/groups", {
      headers: { Cookie: cookieFor(admin) },
    });
    const afterAddBody = (await afterAddRes.json()) as {
      data: Array<{ id: string; memberUserIds: string[] }>;
    };
    const afterAddGroup = afterAddBody.data.find((g) => g.id === groupId);
    expect(afterAddGroup?.memberUserIds).toEqual([member.id]);

    const removeMemberRes = await app.request(
      `/api/v1/admin/groups/${groupId}/members/${member.id}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(admin) },
      },
    );
    expect(removeMemberRes.status).toBe(204);

    const deleteRes = await app.request(`/api/v1/admin/groups/${groupId}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(admin) },
    });
    expect(deleteRes.status).toBe(204);

    const afterDeleteRes = await app.request(
      `/api/v1/admin/groups/${groupId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(admin) },
      },
    );
    expect(afterDeleteRes.status).toBe(404);
  });

  it("cross-org: 다른 org admin 은 그룹을 보지도 수정하지도 못한다", async () => {
    const createRes = await app.request("/api/v1/admin/groups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ name: "org-scoped-group" }),
    });
    const createBody = (await createRes.json()) as { data: { id: string } };
    const groupId = createBody.data.id;

    const otherOrgListRes = await app.request("/api/v1/admin/groups", {
      headers: { Cookie: cookieFor(otherOrgAdmin) },
    });
    const otherOrgListBody = (await otherOrgListRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(otherOrgListBody.data.some((g) => g.id === groupId)).toBe(false);

    const otherOrgRenameRes = await app.request(
      `/api/v1/admin/groups/${groupId}`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(otherOrgAdmin),
        },
        body: JSON.stringify({ name: "hijacked" }),
      },
    );
    expect(otherOrgRenameRes.status).toBe(404);

    const otherOrgDeleteRes = await app.request(
      `/api/v1/admin/groups/${groupId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(otherOrgAdmin) },
      },
    );
    expect(otherOrgDeleteRes.status).toBe(404);
  });

  it("cross-org: 다른 org 사용자를 멤버로 추가할 수 없다", async () => {
    const createRes = await app.request("/api/v1/admin/groups", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ name: "member-scope-group" }),
    });
    const createBody = (await createRes.json()) as { data: { id: string } };
    const groupId = createBody.data.id;

    const addOtherOrgUserRes = await app.request(
      `/api/v1/admin/groups/${groupId}/members`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(admin),
        },
        body: JSON.stringify({ userId: otherOrgAdmin.id }),
      },
    );
    expect(addOtherOrgUserRes.status).toBe(404);
  });
});

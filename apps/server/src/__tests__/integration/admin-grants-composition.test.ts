// admin-grants-composition.test.ts — P20-T1-04 acceptance: routes/admin-grants.ts 의
// grant 생성/조회/회수(/api/v1/admin/grants)가 app.ts 에 실제 mount 돼 있는지 + isAdmin 403
// 게이트 + orgId=auth.org 파생(cross-org subjectId 거부, cross-org 조회 격리)을 실 HTTP +
// 실 Postgres 로 검증. resource_grants(migration 0027) 단일 출처, revoke 는 이 태스크에서
// db/resource-grants-data-access.ts 에 신설.
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

describe("app.ts /api/v1/admin/grants mount — P20-T1-04", () => {
  const org = {
    id: randomUUID(),
    domain: `org-agr-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-agr-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-agr-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-agr-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `admin-agr-other-${randomUUID()}@${otherOrg.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AGR', $2), ($3, 'Org AGR Other', $4)",
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
    await pgPool.query("DELETE FROM resource_grants WHERE org_id = ANY($1)", [
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

  it("미인증 GET /api/v1/admin/grants → 401", async () => {
    const res = await app.request(
      `/api/v1/admin/grants?resourceType=prompt&resourceId=${randomUUID()}`,
    );
    expect(res.status).toBe(401);
  });

  it("비admin POST → 403 FORBIDDEN", async () => {
    const res = await app.request("/api/v1/admin/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ ...member, role: "member" }),
      },
      body: JSON.stringify({
        resourceType: "prompt",
        resourceId: randomUUID(),
        subjectType: "user",
        subjectId: member.id,
        access: "read",
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("필수 필드 없는 POST → 400 INVALID_INPUT", async () => {
    const res = await app.request("/api/v1/admin/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({ resourceType: "prompt" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("생성→목록→회수 전체 흐름", async () => {
    const resourceId = randomUUID();
    const createRes = await app.request("/api/v1/admin/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({
        resourceType: "prompt",
        resourceId,
        subjectType: "user",
        subjectId: member.id,
        access: "read",
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as {
      data: { subjectId: string; access: string };
    };
    expect(createBody.data.subjectId).toBe(member.id);
    expect(createBody.data.access).toBe("read");

    const listRes = await app.request(
      `/api/v1/admin/grants?resourceType=prompt&resourceId=${resourceId}`,
      { headers: { Cookie: cookieFor(admin) } },
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ subjectId: string; access: string }>;
    };
    expect(
      listBody.data.some(
        (g) => g.subjectId === member.id && g.access === "read",
      ),
    ).toBe(true);

    const revokeRes = await app.request(
      `/api/v1/admin/grants?resourceType=prompt&resourceId=${resourceId}&subjectType=user&subjectId=${member.id}&access=read`,
      { method: "DELETE", headers: { Cookie: cookieFor(admin) } },
    );
    expect(revokeRes.status).toBe(204);

    const afterRevokeRes = await app.request(
      `/api/v1/admin/grants?resourceType=prompt&resourceId=${resourceId}`,
      { headers: { Cookie: cookieFor(admin) } },
    );
    const afterRevokeBody = (await afterRevokeRes.json()) as {
      data: Array<{ subjectId: string }>;
    };
    expect(afterRevokeBody.data.some((g) => g.subjectId === member.id)).toBe(
      false,
    );

    const revokeAgainRes = await app.request(
      `/api/v1/admin/grants?resourceType=prompt&resourceId=${resourceId}&subjectType=user&subjectId=${member.id}&access=read`,
      { method: "DELETE", headers: { Cookie: cookieFor(admin) } },
    );
    expect(revokeAgainRes.status).toBe(404);
  });

  it("타 org subjectId 로 grant 생성 시도 → 404(거부)", async () => {
    const res = await app.request("/api/v1/admin/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({
        resourceType: "prompt",
        resourceId: randomUUID(),
        subjectType: "user",
        subjectId: otherOrgAdmin.id,
        access: "read",
      }),
    });
    expect(res.status).toBe(404);
  });

  it("cross-org: 다른 org admin 은 이 org 의 grant 를 조회하지 못한다", async () => {
    const resourceId = randomUUID();
    const createRes = await app.request("/api/v1/admin/grants", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(admin),
      },
      body: JSON.stringify({
        resourceType: "tool",
        resourceId,
        subjectType: "user",
        subjectId: member.id,
        access: "write",
      }),
    });
    expect(createRes.status).toBe(201);

    const otherOrgListRes = await app.request(
      `/api/v1/admin/grants?resourceType=tool&resourceId=${resourceId}`,
      { headers: { Cookie: cookieFor(otherOrgAdmin) } },
    );
    expect(otherOrgListRes.status).toBe(200);
    const otherOrgListBody = (await otherOrgListRes.json()) as {
      data: Array<{ subjectId: string }>;
    };
    expect(otherOrgListBody.data).toEqual([]);
  });
});

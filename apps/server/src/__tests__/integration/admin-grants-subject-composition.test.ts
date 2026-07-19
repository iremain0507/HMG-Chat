// admin-grants-subject-composition.test.ts — P22-T1-07 acceptance:
// (1) db/resource-grants-data-access.ts#grantsForSubject(orgId, subjectType, subjectId)
//     가 해당 subject 가 보유한 grant 전체({resourceType, resourceId, access})를 반환하고
//     명시적 WHERE org_id 로 org 격리됨을 실 Postgres 로 검증.
// (2) routes/admin-grants.ts GET /api/v1/admin/grants?subjectType=group&subjectId=<groupId>
//     subject-scoped 조회가 그룹 카드가 소비할 목록을 내려주고, cross-org groupId 는 빈 목록.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { createPgResourceGrantsDataAccess } from "../../db/resource-grants-data-access.js";
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

describe("admin/grants subject-scoped 조회 — P22-T1-07", () => {
  const org = {
    id: randomUUID(),
    domain: `org-agrs-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-agrs-other-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-agrs-${randomUUID()}@${org.domain}`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    orgId: otherOrg.id,
    email: `admin-agrs-other-${randomUUID()}@${otherOrg.domain}`,
  };
  const groupId = randomUUID();
  const resA = randomUUID();
  const resB = randomUUID();
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";
  const grants = createPgResourceGrantsDataAccess();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AGRS', $2), ($3, 'Org AGRS Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin'), ($4, $5, $6, 'admin')`,
      [
        admin.id,
        org.id,
        admin.email,
        otherOrgAdmin.id,
        otherOrg.id,
        otherOrgAdmin.email,
      ],
    );
    await pgPool.query(
      "INSERT INTO groups (id, org_id, name) VALUES ($1, $2, 'AGRS Group')",
      [groupId, org.id],
    );
    // 이 그룹에 정확히 2개의 resource grant 를 부여(model:read, knowledge:write).
    await pgPool.query(
      `INSERT INTO resource_grants (org_id, resource_type, resource_id, subject_type, subject_id, access) VALUES
         ($1, 'model', $2, 'group', $3, 'read'),
         ($1, 'knowledge', $4, 'group', $3, 'write')`,
      [org.id, resA, groupId, resB],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM resource_grants WHERE org_id = ANY($1)", [
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

  it("grantsForSubject 는 그룹이 보유한 정확히 2개의 grant 를 반환한다", async () => {
    const rows = await grants.grantsForSubject(org.id, "group", groupId);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { resourceType: "model", resourceId: resA, access: "read" },
        { resourceType: "knowledge", resourceId: resB, access: "write" },
      ]),
    );
  });

  it("grantsForSubject 는 명시적 WHERE org_id 로 org 격리된다(다른 org 조회 시 빈 목록)", async () => {
    const rows = await grants.grantsForSubject(otherOrg.id, "group", groupId);
    expect(rows).toEqual([]);
  });

  it("GET ?subjectType=group&subjectId=<groupId> → 그룹 grant 목록", async () => {
    const res = await app.request(
      `/api/v1/admin/grants?subjectType=group&subjectId=${groupId}`,
      { headers: { Cookie: cookieFor(admin) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ resourceType: string; resourceId: string; access: string }>;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data).toEqual(
      expect.arrayContaining([
        { resourceType: "model", resourceId: resA, access: "read" },
        { resourceType: "knowledge", resourceId: resB, access: "write" },
      ]),
    );
  });

  it("cross-org: 다른 org admin 이 이 org 의 groupId 로 조회 → 빈 목록", async () => {
    const res = await app.request(
      `/api/v1/admin/grants?subjectType=group&subjectId=${groupId}`,
      { headers: { Cookie: cookieFor(otherOrgAdmin) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("비admin subject-scoped GET → 403", async () => {
    const res = await app.request(
      `/api/v1/admin/grants?subjectType=group&subjectId=${groupId}`,
      { headers: { Cookie: cookieFor({ ...admin, role: "member" }) } },
    );
    expect(res.status).toBe(403);
  });
});

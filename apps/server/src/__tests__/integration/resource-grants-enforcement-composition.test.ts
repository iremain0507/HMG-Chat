// resource-grants-enforcement-composition.test.ts — P20-T1-11 acceptance: 조회 라우트
// (documents.ts/prompts.ts/mcp-servers.ts)가 resource_grants(migration 0027)를 실제로
// enforcement 하는지 createApp(실HTTP) + 실 Postgres 로 검증한다. audit §4 dead-path 해소 —
// canAccessResource 호출처가 통합테스트뿐이던 상태(실효 enforcement=0)를 해소한다.
// 회귀 방지 핵심(additive-union): "grant 가 하나도 없는 리소스 = 전체 공개"(기존 동작 보존),
// grant 가 하나라도 존재할 때만 canAccessResource(직접 user grant 또는 소속 group grant)로 필터.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { signAccessToken } from "../../middleware/jwt.js";
import { createPgGroupDataAccess } from "../../db/group-data-access.js";
import { createPgResourceGrantsDataAccess } from "../../db/resource-grants-data-access.js";

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

describe("resource_grants enforcement — P20-T1-11 (documents/prompts/mcp-servers 조회 라우트)", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";
  const grantsDa = createPgResourceGrantsDataAccess();
  const groupsDa = createPgGroupDataAccess();

  const org = {
    id: randomUUID(),
    domain: `org-enf-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-enf-other-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" }; // grant 대상(허용)
  const userB = { id: randomUUID(), email: "" }; // grant 미대상(거부)
  const groupMember = { id: randomUUID(), email: "" }; // group grant 로 허용
  let groupId = "";
  const projectId = randomUUID();

  function cookieFor(user: { id: string }, orgId: string): string {
    const token = signAccessToken({ userId: user.id, orgId, role: "member" });
    return `${cookieName}=${token}`;
  }

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ENF', $2), ($3, 'Org ENF Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    userA.email = `user-a-${randomUUID()}@${org.domain}`;
    userB.email = `user-b-${randomUUID()}@${org.domain}`;
    groupMember.email = `user-gm-${randomUUID()}@${org.domain}`;
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7)",
      [
        userA.id,
        org.id,
        userA.email,
        userB.id,
        userB.email,
        groupMember.id,
        groupMember.email,
      ],
    );
    const group = await groupsDa.create(org.id, "enf-test-group");
    groupId = group.id;
    await groupsDa.addMember(org.id, groupId, groupMember.id);

    await pgPool.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Enf Project', 'org')",
      [projectId, org.id, userA.id],
    );
    await pgPool.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES
         ($1, $2, 'owner'), ($1, $3, 'viewer'), ($1, $4, 'viewer')`,
      [projectId, userA.id, userB.id, groupMember.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM resource_grants WHERE org_id = $1", [
      org.id,
    ]);
    await pgPool.query("DELETE FROM project_documents WHERE project_id = $1", [
      projectId,
    ]);
    await pgPool.query("DELETE FROM project_members WHERE project_id = $1", [
      projectId,
    ]);
    await pgPool.query("DELETE FROM projects WHERE id = $1", [projectId]);
    await pgPool.query("DELETE FROM mcp_servers WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM prompts WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM group_members WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM groups WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM users WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
  });

  describe("GET /api/v1/documents", () => {
    async function insertDocument(filename: string) {
      const id = randomUUID();
      await pgPool.query(
        `INSERT INTO project_documents (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by)
         VALUES ($1, $2, $3, $4, 'application/pdf', 10, $5, $6)`,
        [id, projectId, filename, `hash-${id}`, `documents/${id}`, userA.id],
      );
      return id;
    }

    it("grant 0건 문서는 project 멤버 전원에게 노출된다(회귀 보존)", async () => {
      const docId = await insertDocument("public.pdf");

      const res = await app.request(
        `/api/v1/documents?projectId=${projectId}`,
        { headers: { Cookie: cookieFor(userB, org.id) } },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.some((d) => d.id === docId)).toBe(true);
    });

    it("read grant 있는 문서는 대상 user 에게만 노출되고, 미대상 user 목록에서 제외된다", async () => {
      const docId = await insertDocument("restricted.pdf");
      await grantsDa.grant(
        org.id,
        "knowledge",
        docId,
        "user",
        userA.id,
        "read",
      );

      const resA = await app.request(
        `/api/v1/documents?projectId=${projectId}`,
        { headers: { Cookie: cookieFor(userA, org.id) } },
      );
      const bodyA = (await resA.json()) as { data: Array<{ id: string }> };
      expect(bodyA.data.some((d) => d.id === docId)).toBe(true);

      const resB = await app.request(
        `/api/v1/documents?projectId=${projectId}`,
        { headers: { Cookie: cookieFor(userB, org.id) } },
      );
      const bodyB = (await resB.json()) as { data: Array<{ id: string }> };
      expect(bodyB.data.some((d) => d.id === docId)).toBe(false);
    });

    it("group grant 경유로 group 멤버는 노출, 비멤버는 제외된다(additive union)", async () => {
      const docId = await insertDocument("group-restricted.pdf");
      await grantsDa.grant(
        org.id,
        "knowledge",
        docId,
        "group",
        groupId,
        "read",
      );

      const resMember = await app.request(
        `/api/v1/documents?projectId=${projectId}`,
        { headers: { Cookie: cookieFor(groupMember, org.id) } },
      );
      const bodyMember = (await resMember.json()) as {
        data: Array<{ id: string }>;
      };
      expect(bodyMember.data.some((d) => d.id === docId)).toBe(true);

      const resNonMember = await app.request(
        `/api/v1/documents?projectId=${projectId}`,
        { headers: { Cookie: cookieFor(userB, org.id) } },
      );
      const bodyNonMember = (await resNonMember.json()) as {
        data: Array<{ id: string }>;
      };
      expect(bodyNonMember.data.some((d) => d.id === docId)).toBe(false);
    });
  });

  describe("GET /api/v1/prompts", () => {
    async function insertOrgPrompt(command: string) {
      const res = await pgPool.query<{ id: string }>(
        `INSERT INTO prompts (org_id, owner_id, command, title, content, access)
         VALUES ($1, $2, $3, 'title', 'content', 'org') RETURNING id`,
        [org.id, userA.id, command],
      );
      return res.rows[0]!.id;
    }

    it("grant 0건 org 프롬프트는 org 전원에게 노출된다(회귀 보존)", async () => {
      const promptId = await insertOrgPrompt(`/enf-public-${randomUUID()}`);

      const res = await app.request("/api/v1/prompts", {
        headers: { Cookie: cookieFor(userB, org.id) },
      });
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.some((p) => p.id === promptId)).toBe(true);
    });

    it("read grant 있는 프롬프트는 대상 user 에게만 노출된다", async () => {
      const promptId = await insertOrgPrompt(`/enf-restricted-${randomUUID()}`);
      await grantsDa.grant(
        org.id,
        "prompt",
        promptId,
        "user",
        userA.id,
        "read",
      );

      const resA = await app.request("/api/v1/prompts", {
        headers: { Cookie: cookieFor(userA, org.id) },
      });
      const bodyA = (await resA.json()) as { data: Array<{ id: string }> };
      expect(bodyA.data.some((p) => p.id === promptId)).toBe(true);

      const resB = await app.request("/api/v1/prompts", {
        headers: { Cookie: cookieFor(userB, org.id) },
      });
      const bodyB = (await resB.json()) as { data: Array<{ id: string }> };
      expect(bodyB.data.some((p) => p.id === promptId)).toBe(false);

      const getB = await app.request(`/api/v1/prompts/${promptId}`, {
        headers: { Cookie: cookieFor(userB, org.id) },
      });
      expect(getB.status).toBe(404);
    });
  });

  describe("GET /api/v1/mcp-servers", () => {
    async function insertOrgServer(name: string) {
      const res = await pgPool.query<{ id: string }>(
        `INSERT INTO mcp_servers (org_id, name, url, transport)
         VALUES ($1, $2, 'https://mcp.example.com/x', 'streamable_http') RETURNING id`,
        [org.id, name],
      );
      return res.rows[0]!.id;
    }

    it("grant 0건 서버는 org 전원에게 노출된다(회귀 보존)", async () => {
      const serverId = await insertOrgServer(`enf-public-${randomUUID()}`);

      const res = await app.request("/api/v1/mcp-servers", {
        headers: { Cookie: cookieFor(userB, org.id) },
      });
      const body = (await res.json()) as { data: Array<{ id: string }> };
      expect(body.data.some((s) => s.id === serverId)).toBe(true);
    });

    it("read grant 있는 서버는 대상 user 에게만 노출된다", async () => {
      const serverId = await insertOrgServer(`enf-restricted-${randomUUID()}`);
      await grantsDa.grant(org.id, "tool", serverId, "user", userA.id, "read");

      const resA = await app.request("/api/v1/mcp-servers", {
        headers: { Cookie: cookieFor(userA, org.id) },
      });
      const bodyA = (await resA.json()) as { data: Array<{ id: string }> };
      expect(bodyA.data.some((s) => s.id === serverId)).toBe(true);

      const resB = await app.request("/api/v1/mcp-servers", {
        headers: { Cookie: cookieFor(userB, org.id) },
      });
      const bodyB = (await resB.json()) as { data: Array<{ id: string }> };
      expect(bodyB.data.some((s) => s.id === serverId)).toBe(false);
    });
  });
});

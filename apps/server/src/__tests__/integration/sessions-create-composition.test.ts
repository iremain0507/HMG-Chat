// sessions-create-composition.test.ts — P22-T1-04 acceptance: POST /sessions(명시적 생성,
// 16-API-CONTRACT §418) 가 실 Postgres + createApp(실HTTP) 에서 서버생성 id 로 영속하고
// userId 는 auth 에서만 파생돼 cross-user 격리되는지 검증한다(L1 last-mile — 유닛만으로는
// 마운트/영속/auth-파생 결합을 증명 못 함).
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

describe("routes/sessions.ts POST /(app.ts 실 조립) — P22-T1-04", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-sesscr-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-sesscr-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;
  const projectA = { id: randomUUID() };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SessCr A', $2), ($3, 'Org SessCr B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
    await pgPool.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Proj A', 'private')",
      [projectA.id, orgA.id, userA.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM projects WHERE id = $1", [projectA.id]);
    await pgPool.query("DELETE FROM users WHERE id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [
      orgA.id,
      orgB.id,
    ]);
  });

  function cookieFor(user: { id: string }, org: { id: string }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  it("POST / (body {}) 는 201 + 서버생성 id 로 세션을 생성·영속한다", async () => {
    const res = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        id: string;
        title: string | null;
        projectId: string | null;
        createdAt: string;
      };
      meta: { requestId: string };
    };
    expect(json.data.title).toBeNull();
    expect(json.data.projectId).toBeNull();
    expect(typeof json.data.createdAt).toBe("string");
    expect(json.meta.requestId).toBeTruthy();

    const row = await pgPool.query(
      "SELECT user_id FROM sessions WHERE id = $1",
      [json.data.id],
    );
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].user_id).toBe(userA.id);
  });

  it("POST / (body {title, projectId}) 는 값을 round-trip 하고 이후 목록에 나타난다", async () => {
    const res = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({ title: "Plan", projectId: projectA.id }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; title: string | null; projectId: string | null };
    };
    expect(json.data.title).toBe("Plan");
    expect(json.data.projectId).toBe(projectA.id);

    const listRes = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(listJson.data.some((s) => s.id === json.data.id)).toBe(true);
  });

  it("POST / 로 A 가 만든 세션은 B(다른 org/user) 의 목록에 보이지 않는다(userId=auth 파생)", async () => {
    const res = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({ title: "A-only" }),
    });
    const created = (await res.json()) as { data: { id: string } };

    const listRes = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((s) => s.id === created.data.id)).toBe(false);
  });

  it("POST / 는 미인증 요청에 401 을 반환한다", async () => {
    const res = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

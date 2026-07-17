// session-tags-composition.test.ts — P19-T1-04: 세션 태그(migration 0020 session_tags) 추가/
// 제거 + GET /sessions?tag= 필터가 실 Postgres + createApp(실HTTP)에서 동작·영속·cross-org
// 격리되는지 검증한다(L1 last-mile — 유닛만으로는 마운트/영속/RLS 결합을 증명 못 함).
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

describe("routes/sessions.ts 태그 CRUD+필터(app.ts 실 조립) — P19-T1-04", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-tags-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-tags-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Tags A', $2), ($3, 'Org Tags B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
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

  async function createSession(userId: string, title: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, userId, title],
    );
    return id;
  }

  it("POST /api/v1/sessions/:id/tags 로 추가 후 GET /sessions 목록에 반영되고 ?tag= 로 필터된다", async () => {
    const sessionId = await createSession(userA.id, "태그대상");
    const otherSessionId = await createSession(userA.id, "태그없음");

    const addRes = await app.request(`/api/v1/sessions/${sessionId}/tags`, {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ tag: "업무" }),
    });
    expect(addRes.status).toBe(201);
    const addJson = (await addRes.json()) as { data: { tag: string } };
    expect(addJson.data.tag).toBe("업무");

    const listRes = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string; tags: string[] }>;
    };
    const found = listJson.data.find((s) => s.id === sessionId);
    expect(found?.tags).toEqual(["업무"]);

    const filterRes = await app.request("/api/v1/sessions?tag=업무", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const filterJson = (await filterRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(filterJson.data.some((s) => s.id === sessionId)).toBe(true);
    expect(filterJson.data.some((s) => s.id === otherSessionId)).toBe(false);
  });

  it("DELETE /api/v1/sessions/:id/tags/:tag 로 제거되면 필터 목록에서 사라진다", async () => {
    const sessionId = await createSession(userA.id, "태그제거대상");
    await app.request(`/api/v1/sessions/${sessionId}/tags`, {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ tag: "임시태그" }),
    });

    const deleteRes = await app.request(
      `/api/v1/sessions/${sessionId}/tags/${encodeURIComponent("임시태그")}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userA, orgA) },
      },
    );
    expect(deleteRes.status).toBe(204);

    const row = await pgPool.query(
      "SELECT tag FROM session_tags WHERE session_id = $1",
      [sessionId],
    );
    expect(row.rows.length).toBe(0);

    const missingRes = await app.request(
      `/api/v1/sessions/${sessionId}/tags/${encodeURIComponent("임시태그")}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userA, orgA) },
      },
    );
    expect(missingRes.status).toBe(404);
  });

  it("cross-org — B 는 A 의 세션에 태그를 추가/제거할 수 없다(404)", async () => {
    const sessionId = await createSession(userA.id, "A전용");

    const addRes = await app.request(`/api/v1/sessions/${sessionId}/tags`, {
      method: "POST",
      headers: {
        Cookie: cookieFor(userB, orgB),
        "content-type": "application/json",
      },
      body: JSON.stringify({ tag: "가로채기" }),
    });
    expect(addRes.status).toBe(404);

    await app.request(`/api/v1/sessions/${sessionId}/tags`, {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ tag: "A태그" }),
    });

    const deleteRes = await app.request(
      `/api/v1/sessions/${sessionId}/tags/${encodeURIComponent("A태그")}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userB, orgB) },
      },
    );
    expect(deleteRes.status).toBe(404);

    const row = await pgPool.query(
      "SELECT tag FROM session_tags WHERE session_id = $1",
      [sessionId],
    );
    expect(row.rows.length).toBe(1);

    const listRes = await app.request("/api/v1/sessions?tag=A태그", {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((s) => s.id === sessionId)).toBe(false);
  });
});

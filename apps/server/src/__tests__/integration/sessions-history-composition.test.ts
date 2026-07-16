// sessions-history-composition.test.ts — P17-T1-02 acceptance(TS-08/10): routes/sessions.ts 의
// GET /(내 세션 목록) + GET /:id/messages(히스토리) 가 실 Postgres + createApp(실HTTP) 에서
// 404 가 아닌 실제 데이터를 반환하고, 타 사용자 세션은 격리되는지 검증한다
// (L1 last-mile — 유닛만으로는 마운트/영속 결합을 증명 못 함).
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

describe("routes/sessions.ts 세션 목록·히스토리(app.ts 실 조립) — P17-T1-02", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-sesshist-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-sesshist-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: `` };
  const userB = { id: randomUUID(), email: `` };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  let sessionAId: string;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SessHist A', $2), ($3, 'Org SessHist B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );

    sessionAId = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'sesshist-A')",
      [sessionAId, userA.id],
    );
    await pgPool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2), ($1, 'assistant', $3)",
      [sessionAId, JSON.stringify("hi from A"), JSON.stringify("hello A")],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id IN ($1, $2))",
      [userA.id, userB.id],
    );
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

  it("GET /sessions 는 404 가 아니라 내 세션 배열을 최신순으로 반환한다", async () => {
    const res = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ id: string; title: string | null }>;
    };
    expect(json.data.some((s) => s.id === sessionAId)).toBe(true);
  });

  it("GET /sessions 는 cross-org 격리 — B 사용자에게 A 의 세션이 보이지 않는다", async () => {
    const res = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === sessionAId)).toBe(false);
  });

  it("GET /sessions/:id/messages 는 저장된 히스토리를 순서대로 반환한다", async () => {
    const res = await app.request(`/api/v1/sessions/${sessionAId}/messages`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ role: string; content: unknown }>;
    };
    expect(json.data.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(json.data[0].content).toBe("hi from A");
  });

  it("GET /sessions/:id/messages 는 타 사용자 세션에 404 를 반환한다(존재 leak 방지)", async () => {
    const res = await app.request(`/api/v1/sessions/${sessionAId}/messages`, {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(res.status).toBe(404);
  });
});

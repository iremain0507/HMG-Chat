// sessions-pin-composition.test.ts — P19-T1-02: 세션 핀 서버 영속(migration 0018 sessions.pinned_at)이
// 실 Postgres + createApp(실HTTP)에서 토글·영속·cross-org 격리되는지 검증한다
// (L1 last-mile — 유닛만으로는 마운트/영속/RLS 결합을 증명 못 함).
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

describe("routes/sessions.ts PATCH /:id/pin(app.ts 실 조립) — P19-T1-02", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-sesspin-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-sesspin-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SessPin A', $2), ($3, 'Org SessPin B', $4)",
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

  async function createSession(title: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, userA.id, title],
    );
    return id;
  }

  it("PATCH /:id/pin 은 토글이다 — 1회차 고정, 2회차 해제, 둘 다 영속된다", async () => {
    const sessionId = await createSession("to-pin");

    const res1 = await app.request(`/api/v1/sessions/${sessionId}/pin`, {
      method: "PATCH",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res1.status).toBe(200);
    const json1 = (await res1.json()) as { data: { pinned: boolean } };
    expect(json1.data.pinned).toBe(true);

    const row1 = await pgPool.query(
      "SELECT pinned_at FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(row1.rows[0].pinned_at).not.toBeNull();

    const res2 = await app.request(`/api/v1/sessions/${sessionId}/pin`, {
      method: "PATCH",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res2.status).toBe(200);
    const json2 = (await res2.json()) as { data: { pinned: boolean } };
    expect(json2.data.pinned).toBe(false);

    const row2 = await pgPool.query(
      "SELECT pinned_at FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(row2.rows[0].pinned_at).toBeNull();
  });

  it("GET / 목록 응답이 pinned 를 반영한다", async () => {
    const sessionId = await createSession("list-reflects-pin");
    await app.request(`/api/v1/sessions/${sessionId}/pin`, {
      method: "PATCH",
      headers: { Cookie: cookieFor(userA, orgA) },
    });

    const listRes = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string; pinned: boolean }>;
    };
    const found = listJson.data.find((s) => s.id === sessionId);
    expect(found?.pinned).toBe(true);
  });

  it("PATCH /:id/pin 은 cross-org — B 가 A 의 세션을 고정할 수 없다(404, 미변경)", async () => {
    const sessionId = await createSession("protected-from-b");
    const res = await app.request(`/api/v1/sessions/${sessionId}/pin`, {
      method: "PATCH",
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(res.status).toBe(404);

    const row = await pgPool.query(
      "SELECT pinned_at FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(row.rows[0].pinned_at).toBeNull();
  });
});

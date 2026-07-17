// message-feedback-composition.test.ts — P19-T1-07: 메시지 평가(migration 0023
// message_feedback) upsert/토글 취소 + 조회가 실 Postgres + createApp(실HTTP)에서 동작·영속·
// cross-org 격리되는지 검증한다(L1 last-mile — 유닛만으로는 마운트/영속/RLS 결합을 증명 못 함).
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

describe("routes/sessions.ts POST/GET /:id/messages/:messageId/feedback(app.ts 실 조립) — P19-T1-07", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-msgfb-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-msgfb-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MsgFB A', $2), ($3, 'Org MsgFB B', $4)",
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

  async function createSessionWithMessage(
    userId: string,
    title: string,
  ): Promise<{ sessionId: string; messageId: string }> {
    const sessionId = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [sessionId, userId, title],
    );
    const res = await pgPool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'assistant', $2::jsonb) RETURNING id",
      [sessionId, JSON.stringify("assistant reply")],
    );
    return { sessionId, messageId: res.rows[0].id as string };
  }

  it("POST 로 평가(1) upsert 후 GET 으로 조회되고, 같은 값 재요청 시 토글 취소(null)된다", async () => {
    const { sessionId, messageId } = await createSessionWithMessage(
      userA.id,
      "평가대상",
    );

    const upsertRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      {
        method: "POST",
        headers: {
          Cookie: cookieFor(userA, orgA),
          "content-type": "application/json",
        },
        body: JSON.stringify({ rating: 1 }),
      },
    );
    expect(upsertRes.status).toBe(200);
    const upsertJson = (await upsertRes.json()) as {
      data: { messageId: string; rating: number | null };
    };
    expect(upsertJson.data.rating).toBe(1);

    const getRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(getRes.status).toBe(200);
    const getJson = (await getRes.json()) as {
      data: { rating: number | null };
    };
    expect(getJson.data.rating).toBe(1);

    const toggleRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      {
        method: "POST",
        headers: {
          Cookie: cookieFor(userA, orgA),
          "content-type": "application/json",
        },
        body: JSON.stringify({ rating: 1 }),
      },
    );
    expect(toggleRes.status).toBe(200);
    const toggleJson = (await toggleRes.json()) as {
      data: { rating: number | null };
    };
    expect(toggleJson.data.rating).toBeNull();

    const row = await pgPool.query(
      "SELECT rating FROM message_feedback WHERE message_id = $1",
      [messageId],
    );
    expect(row.rows.length).toBe(0);
  });

  it("rating 이 1/-1 이 아니면 400 INVALID_INPUT", async () => {
    const { sessionId, messageId } = await createSessionWithMessage(
      userA.id,
      "검증대상",
    );
    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      {
        method: "POST",
        headers: {
          Cookie: cookieFor(userA, orgA),
          "content-type": "application/json",
        },
        body: JSON.stringify({ rating: 2 }),
      },
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_INPUT");
  });

  it("cross-org — B 는 A 의 메시지를 평가/조회할 수 없다(404)", async () => {
    const { sessionId, messageId } = await createSessionWithMessage(
      userA.id,
      "A전용",
    );

    const postRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      {
        method: "POST",
        headers: {
          Cookie: cookieFor(userB, orgB),
          "content-type": "application/json",
        },
        body: JSON.stringify({ rating: 1 }),
      },
    );
    expect(postRes.status).toBe(404);

    const getRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    expect(getRes.status).toBe(404);

    const row = await pgPool.query(
      "SELECT rating FROM message_feedback WHERE message_id = $1",
      [messageId],
    );
    expect(row.rows.length).toBe(0);
  });
});

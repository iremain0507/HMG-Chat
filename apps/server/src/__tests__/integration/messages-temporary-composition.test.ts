// messages-temporary-composition.test.ts — P19-T2-05 acceptance: routes/messages.ts 가
// body.temporary=true 인 턴을 실제로 미영속(세션 upsert·messages insert 모두 스킵)하면서도
// 스트림은 정상 종단하는지 createApp(실HTTP) + 실 Postgres 로 검증한다(21-LOOP-LESSONS.md
// L1 last-mile — 유닛만으로는 실제 DB에 아무 것도 남지 않음을 증명하지 못한다).
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

describe("routes/messages.ts 임시 채팅(temporary) 미영속(app.ts 실 조립) — P19-T2-05", () => {
  const org = {
    id: randomUUID(),
    domain: `org-temp-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-temp-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Temp', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [user.id],
    );
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [user.id],
    );
    await pgPool.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function authCookie(): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  it("temporary=true 턴은 스트림은 정상 종단하지만 sessions/messages 테이블에 아무 행도 남기지 않는다", async () => {
    const sessionId = randomUUID();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "temporary hello", temporary: true }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: stop");

    const sessionRows = await pgPool.query(
      "SELECT id FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(sessionRows.rows).toHaveLength(0);

    const messageRows = await pgPool.query(
      "SELECT id FROM messages WHERE session_id = $1",
      [sessionId],
    );
    expect(messageRows.rows).toHaveLength(0);
  });

  it("temporary 미지정(기존 동작)은 여전히 세션+메시지가 영속된다(회귀 가드)", async () => {
    const sessionId = randomUUID();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "persisted hello" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const sessionRows = await pgPool.query(
      "SELECT id FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(sessionRows.rows).toHaveLength(1);

    const messageRows = await pgPool.query(
      "SELECT role FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId],
    );
    expect(messageRows.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  });
});

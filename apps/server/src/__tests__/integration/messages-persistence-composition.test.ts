// messages-persistence-composition.test.ts — P17-T1-01 acceptance(TS-08): routes/messages.ts 가
// 턴마다 user+assistant 메시지를 messages 테이블(0002_sessions_messages.sql)에 실제 저장하는지
// createApp(실HTTP) + 실 Postgres 로 검증한다(L1 last-mile — 유닛만으로는 실제 영속을 증명 못 함).
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

describe("routes/messages.ts 메시지 영속(app.ts 실 조립) — P17-T1-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-msgpersist-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-msgpersist-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MsgPersist', $2)",
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

  async function createSession(): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'persist-test')",
      [id, user.id],
    );
    return id;
  }

  it("정상 턴 완료 후 messages 테이블에 user+assistant 행이 저장된다", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "hello persisted world" }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const rows = await pgPool.query(
      "SELECT role, content, tokens_in, tokens_out FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].role).toBe("user");
    expect(rows.rows[0].content).toBe("hello persisted world");
    expect(rows.rows[1].role).toBe("assistant");
    expect(rows.rows[1].content).toContain("hello persisted world");
    expect(rows.rows[1].tokens_in).not.toBeNull();
    expect(rows.rows[1].tokens_out).not.toBeNull();
  });

  it("Stop(취소) 경로에서도 assistant 행이 저장된다", async () => {
    const sessionId = await createSession();
    const postPromise = app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "cancel me please" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cancelRes = await app.request(
      `/api/v1/sessions/${sessionId}/active-run`,
      { method: "DELETE", headers: { Cookie: authCookie() } },
    );
    expect(cancelRes.status).toBe(200);

    const res = await postPromise;
    expect(res.status).toBe(200);
    await res.text();

    const rows = await pgPool.query(
      "SELECT role FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId],
    );
    expect(rows.rows.map((r) => r.role)).toEqual(["user", "assistant"]);
  });
});

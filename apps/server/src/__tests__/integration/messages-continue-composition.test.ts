// messages-continue-composition.test.ts — P19-T2-03 acceptance: routes/messages.ts 의
// POST /sessions/:id/messages/:mid/continue 가 직전 assistant 텍스트를 prefix 로 이어서
// 기존 SSE 파이프(text_delta/stop, 신규 이벤트 없음)를 재사용해 스트리밍하고, 완료 시 원본
// assistant 메시지 행(mid)을 prefix+새텍스트로 update 하는지 createApp(실HTTP, 실 Postgres)
// 로 검증한다(21-LOOP-LESSONS.md L1 last-mile).
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

describe("routes/messages.ts 응답 이어쓰기(continue) — P19-T2-03", () => {
  const org = {
    id: randomUUID(),
    domain: `org-continue-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-continue-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Continue', $2)",
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'continue-test')",
      [id, user.id],
    );
    return id;
  }

  async function firstTurn(sessionId: string): Promise<{
    assistantId: string;
    assistantContent: string;
  }> {
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "part one of the answer" }),
    });
    expect(res.status).toBe(200);
    await res.text();
    const rows = await pgPool.query(
      "SELECT id, content FROM messages WHERE session_id = $1 AND role = 'assistant' ORDER BY created_at ASC",
      [sessionId],
    );
    return {
      assistantId: rows.rows[0].id as string,
      assistantContent: rows.rows[0].content as string,
    };
  }

  it("직전 assistant 텍스트 뒤에 이어지는 text_delta·stop 을 스트리밍하고 같은 행을 update 한다(새 행 생성 아님)", async () => {
    const sessionId = await createSession();
    const { assistantId, assistantContent } = await firstTurn(sessionId);

    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${assistantId}/continue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie() },
        body: "{}",
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: stop");
    // 신규 SSE 이벤트 금지 — 기존 13-variant 밖 이벤트명이 섞이지 않아야 한다.
    expect(text).not.toContain("event: continue");

    const rows = await pgPool.query(
      "SELECT id, role, content FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
      [sessionId],
    );
    // user + assistant 2행 그대로 — continue 가 새 행을 추가하지 않고 기존 assistant 행을 update.
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[1].id).toBe(assistantId);
    expect(rows.rows[1].content).not.toBe(assistantContent);
    expect(rows.rows[1].content.startsWith(assistantContent)).toBe(true);
    expect(rows.rows[1].content.length).toBeGreaterThan(
      assistantContent.length,
    );
  });

  it("assistant 가 아닌 메시지(user)를 continue 하면 400", async () => {
    const sessionId = await createSession();
    await firstTurn(sessionId);
    const rows = await pgPool.query(
      "SELECT id FROM messages WHERE session_id = $1 AND role = 'user' ORDER BY created_at ASC LIMIT 1",
      [sessionId],
    );
    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${rows.rows[0].id}/continue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie() },
        body: "{}",
      },
    );
    expect(res.status).toBe(400);
  });

  it("존재하지 않는 메시지를 continue 하면 404", async () => {
    const sessionId = await createSession();
    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${randomUUID()}/continue`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie() },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });
});

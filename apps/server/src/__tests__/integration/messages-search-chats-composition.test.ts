// messages-search-chats-composition.test.ts — P20-T2-01 acceptance: assemble-builtin-tools.ts
// 가 search_chats/view_chat 을 실제 도구셋에 항상 조립하고 app.ts 가 기존 sessionDa/messageDa
// 를 주입하는지 createApp(실HTTP)로 검증한다(L1 last-mile). dev-stub LLMProvider 의 결정적
// 트리거(`USE_TOOL <tool> <jsonArgs>`, P11-T2-02)로 tool_use 를 재현해 두 도구가 실제 turn 에서
// tool_use→tool_result 왕복하고, 결과가 호출자 본인 세션으로만 스코프됨을 단언한다(cross-user).
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

describe("routes/messages.ts search_chats/view_chat 도구 배선(app.ts 실 조립) — P20-T2-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-schats-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-schats-${randomUUID()}@${org.domain}`,
  };
  const otherUser = {
    id: randomUUID(),
    email: `other-schats-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SChats', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [user.id, org.id, user.email, otherUser.id, otherUser.email],
    );
  });

  afterAll(async () => {
    for (const u of [user, otherUser]) {
      await pgPool.query(
        "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
        [u.id],
      );
      await pgPool.query(
        "DELETE FROM sessions_active_runs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
        [u.id],
      );
      await pgPool.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      await pgPool.query("DELETE FROM users WHERE id = $1", [u.id]);
    }
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function authCookie(forUser: { id: string }): string {
    const token = signAccessToken({
      userId: forUser.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  async function createSession(
    forUser: { id: string },
    title: string,
  ): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, forUser.id, title],
    );
    return id;
  }

  it("search_chats 툴 tool_use→tool_result 왕복이 실앱(createApp)에서 동작하고 본인 세션만 반환한다", async () => {
    await createSession(user, "widget 사용법 정리");
    await createSession(otherUser, "widget 사용법 (타 유저)");
    const callerSession = await createSession(user, "unrelated caller session");

    const res = await app.request(
      `/api/v1/sessions/${callerSession}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Cookie: authCookie(user),
        },
        body: JSON.stringify({
          content: 'USE_TOOL search_chats {"query":"widget"}',
        }),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"search_chats"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("widget 사용법 정리");
    expect(text).not.toContain("widget 사용법 (타 유저)");
  });

  it("view_chat 툴 tool_use→tool_result 왕복이 실앱(createApp)에서 동작하고 타 유저 세션은 NOT_FOUND 로 거부한다", async () => {
    const otherSession = await createSession(otherUser, "other's private chat");
    const callerSession = await createSession(user, "caller viewing session");

    const res = await app.request(
      `/api/v1/sessions/${callerSession}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Cookie: authCookie(user),
        },
        body: JSON.stringify({
          content: `USE_TOOL view_chat {"sessionId":"${otherSession}"}`,
        }),
      },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"view_chat"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("NOT_FOUND");
  });
});

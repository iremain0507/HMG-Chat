// messages-memory-tools-composition.test.ts — P20-T1-10 acceptance: assemble-builtin-tools.ts
// 가 add_memory/search_memories 를 실제 도구셋에 항상 조립하고 app.ts 가 기존 userMemoryDa
// 싱글톤을 주입하는지 createApp(실HTTP)로 검증한다(L1 last-mile). dev-stub LLMProvider 의
// 결정적 트리거(`USE_TOOL <tool> <jsonArgs>`, P11-T2-02)로 tool_use 를 재현해 add_memory 가
// 실제 user_memories 행을 만들고, search_memories 가 그 행을 반환하며, 다른 유저에게는
// 보이지 않음(cross-actor 격리)을 단언한다.
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

describe("routes/messages.ts add_memory/search_memories 도구 배선(app.ts 실 조립) — P20-T1-10", () => {
  const org = {
    id: randomUUID(),
    domain: `org-memtools-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-memtools-${randomUUID()}@${org.domain}`,
  };
  const otherUser = {
    id: randomUUID(),
    email: `other-memtools-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MemTools', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [user.id, org.id, user.email, otherUser.id, otherUser.email],
    );
  });

  afterAll(async () => {
    for (const u of [user, otherUser]) {
      await pgPool.query("DELETE FROM user_memories WHERE user_id = $1", [
        u.id,
      ]);
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

  it("add_memory 툴 tool_use→tool_result 왕복이 실앱(createApp)에서 동작하고 실제 user_memories 행을 만든다", async () => {
    const session = await createSession(user, "add_memory 대화");

    const res = await app.request(`/api/v1/sessions/${session}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: authCookie(user),
      },
      body: JSON.stringify({
        content:
          'USE_TOOL add_memory {"category":"user","content":"사용자는 파란색을 좋아한다"}',
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"add_memory"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("사용자는 파란색을 좋아한다");

    const dbRes = await pgPool.query(
      "SELECT user_id, category, content FROM user_memories WHERE user_id = $1",
      [user.id],
    );
    expect(dbRes.rows).toHaveLength(1);
    expect(dbRes.rows[0].category).toBe("user");
    expect(dbRes.rows[0].content).toBe("사용자는 파란색을 좋아한다");
  });

  it("search_memories 툴이 본인 저장 메모리만 반환하고(cross-actor 격리) 타 유저 메모리는 노출하지 않는다", async () => {
    const mySession = await createSession(user, "search_memories 대화");
    const otherSession = await createSession(otherUser, "타 유저 대화");

    const seedMine = await app.request(
      `/api/v1/sessions/${mySession}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Cookie: authCookie(user),
        },
        body: JSON.stringify({
          content:
            'USE_TOOL add_memory {"category":"reference","content":"본인 전용 메모"}',
        }),
      },
    );
    await seedMine.text(); // 스트림을 완전히 소진해야 서버측 tool invoke(INSERT)가 완료됨을 보장.
    const seedOther = await app.request(
      `/api/v1/sessions/${otherSession}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Cookie: authCookie(otherUser),
        },
        body: JSON.stringify({
          content:
            'USE_TOOL add_memory {"category":"reference","content":"타 유저 전용 메모"}',
        }),
      },
    );
    await seedOther.text();

    const res = await app.request(`/api/v1/sessions/${mySession}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: authCookie(user),
      },
      body: JSON.stringify({
        content: 'USE_TOOL search_memories {"category":"reference"}',
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"search_memories"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("본인 전용 메모");
    expect(text).not.toContain("타 유저 전용 메모");
  });
});

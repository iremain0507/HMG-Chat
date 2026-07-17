// messages-mode-toggle-composition.test.ts — P19-T2-02 acceptance: routes/messages.ts 가
// body.mode 를 실제로 소비해 'chat'=도구 없이 순수 대화(tools=[]), 'agent'(또는 미지정)=
// 도구 활성으로 runTurn 에 반영하는지 실HTTP(createApp, 실 Postgres)로 검증한다(21-LOOP-LESSONS.md
// L1 last-mile — 이전엔 payload 로만 전송되고 서버가 소비하지 않는 no-op 였다).
// dev-stub LLMProvider 의 결정적 트리거 `"USE_TOOL <toolName> <jsonArgs>"` 는 등록된 tools 에
// 해당 이름이 없으면 무시하고 echo 로 폴백하므로(llm-provider-dev-stub.ts), 이 신호로 실제
// tools 배열 포함 여부를 블랙박스로 관측할 수 있다.
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

const USE_ARTIFACT =
  'USE_TOOL artifact_create {"filename":"note.md","type":"markdown","content":"hi"}';

describe("routes/messages.ts 모드(agent/chat) 배선 — P19-T2-02", () => {
  const org = {
    id: randomUUID(),
    domain: `org-mode-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-mode-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Mode', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM artifacts WHERE created_by = $1", [
      user.id,
    ]);
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'mode-test')",
      [id, user.id],
    );
    return id;
  }

  it("mode='agent' → tool_use 가 발생한다(도구 활성)", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: USE_ARTIFACT, mode: "agent" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"artifact_create"');
  });

  it("mode='chat' → tools=[] 라 tool_use 없이 echo 로 폴백한다(순수 대화)", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: USE_ARTIFACT, mode: "chat" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("event: tool_use");
    expect(text).toContain("USE_TOOL artifact_create");
  });
});

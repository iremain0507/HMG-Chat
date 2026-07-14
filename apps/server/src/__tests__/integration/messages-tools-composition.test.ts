// messages-tools-composition.test.ts — P11-T2-02 acceptance: routes/messages.ts 가
// 내장 핸들러(artifact_create)를 AgentTool[] 로 조립해 runTurn 에 tools+toolContext 주입 +
// body.model 을 org.allowedModels 화이트리스트로 검증해 실 turn model 로 반영하는지, 실HTTP
// (createApp, 실 DB)로 검증한다. dev-stub LLMProvider 는 원래 tool_use 를 못 만드므로
// (echo 전용), orchestrator/llm-provider-dev-stub.ts 가 이 태스크에서 추가한 결정적 트리거
// `"USE_TOOL <toolName> <jsonArgs>"` 를 사용해 tool_use 를 재현한다.
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

describe("routes/messages.ts tool/model 배선 — P11-T2-02", () => {
  const org = {
    id: randomUUID(),
    domain: `org-tools-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-tools-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      `INSERT INTO organizations (id, name, domain, allowed_models)
       VALUES ($1, 'Org Tools', $2, $3::jsonb)`,
      [org.id, org.domain, JSON.stringify(["dev-stub-custom"])],
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'tools-test')",
      [id, user.id],
    );
    return id;
  }

  it("body.model 이 org.allowedModels 안이면 실 turn 의 model 로 반영된다", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "hi", model: "dev-stub-custom" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"model":"dev-stub-custom"');
  });

  it("body.model 이 org.allowedModels 밖이면 400 MODEL_NOT_ALLOWED", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "hi", model: "not-allowed-model" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("MODEL_NOT_ALLOWED");
  });

  it("artifact_create 툴 tool_use→tool_result 왕복이 실앱(createApp)에서 동작한다", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: authCookie(),
      },
      body: JSON.stringify({
        content:
          'USE_TOOL artifact_create {"filename":"note.md","type":"markdown","content":"hi"}',
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"artifact_create"');
    expect(text).toContain("event: tool_result");
    expect(text).toContain("event: artifact_created");

    const row = await pgPool.query(
      "SELECT filename FROM artifacts WHERE session_id = $1",
      [sessionId],
    );
    expect(row.rows[0]?.filename).toBe("note.md");
  });
});

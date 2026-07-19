// messages-knowledge-search-composition.test.ts — P20-T1-02 acceptance: assemble-builtin-tools.ts
// 가 createKnowledgeSearchTool 을 실제 도구셋에 조립하고 app.ts 가 KnowledgeRetrievalPort(pg,
// P20-T3-02)+embeddingProvider 를 주입하는지 createApp(실HTTP)로 검증한다(L1 last-mile —
// 이전엔 assemble-builtin-tools.ts·app.ts 어디에도 knowledge_search 가 없어 모델이 지식베이스를
// 절대 조회할 수 없었다). dev-stub LLMProvider 의 결정적 트리거(`USE_TOOL <tool> <jsonArgs>`,
// P11-T2-02)로 tool_use 를 재현해 knowledge_search 가 실제 turn 에서 tool_use→tool_result 왕복
// 하는지 단언한다.
//
// 알려진 범위 밖 gap: routes/messages.ts 는 아직 ToolContext.projectId 를 세션의 project_id 로
// 채우지 않는다(grep 0건 — 이 파일은 이 태스크 files 밖). 그래서 이 턴에서는 KnowledgeRetrievalPort.
// loadCandidates 가 projectId=undefined 로 호출돼 항상 빈 candidates(NO_RESULTS_MESSAGE)를
// 반환한다 — citation 이 실제 문서로 채워지는 것까지는 이 테스트로 증명하지 않는다(후속
// messages.ts 배선 필요, P14-T3-02/P15-T3-01 과 동일한 구조적 격리 사유). 여기서는 도구가
// 실제로 조립되어 tool_use/tool_result 로 도달한다는 last-mile 만 단언한다.
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

describe("routes/messages.ts knowledge_search 도구 배선(app.ts 실 조립) — P20-T1-02", () => {
  const org = {
    id: randomUUID(),
    domain: `org-ksearch-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-ksearch-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org KSearch', $2)",
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'ksearch-test')",
      [id, user.id],
    );
    return id;
  }

  it("knowledge_search 툴 tool_use→tool_result 왕복이 실앱(createApp)에서 동작한다(도구가 실제로 조립됨)", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Cookie: authCookie(),
      },
      body: JSON.stringify({
        content: 'USE_TOOL knowledge_search {"query":"widget 사용법"}',
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"knowledge_search"');
    expect(text).toContain("event: tool_result");
  });
});

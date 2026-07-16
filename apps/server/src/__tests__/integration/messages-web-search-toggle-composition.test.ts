// messages-web-search-toggle-composition.test.ts — P19-T2-01 acceptance: routes/messages.ts 가
// body.webSearch(요청) + org_settings.webSearchEnabled(admin)을 실제로 소비해 web_search 를
// tool set 에 포함/제외하는지 실HTTP(createApp, 실 Postgres)로 검증한다(21-LOOP-LESSONS.md L1
// last-mile — 이전엔 payload 로만 전송되고 서버가 소비하지 않는 no-op 였다).
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

const USE_WEB_SEARCH = 'USE_TOOL web_search {"query":"wia"}';

describe("routes/messages.ts 웹검색 토글 배선 — P19-T2-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-wsearch-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-wsearch-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org WSearch', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [admin.id, org.id, admin.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [admin.id],
    );
    await pgPool.query("DELETE FROM sessions WHERE user_id = $1", [admin.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [admin.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function authCookie(): string {
    const token = signAccessToken({
      userId: admin.id,
      orgId: org.id,
      role: "admin",
    });
    return `${cookieName}=${token}`;
  }

  async function createSession(): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'wsearch-test')",
      [id, admin.id],
    );
    return id;
  }

  async function setAdminWebSearch(enabled: boolean): Promise<void> {
    const res = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ webSearchEnabled: enabled }),
    });
    expect(res.status).toBe(200);
  }

  it("admin on + 요청 webSearch=true → web_search 가 tool set 에 포함된다", async () => {
    await setAdminWebSearch(true);
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: USE_WEB_SEARCH, webSearch: true }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: tool_use");
    expect(text).toContain('"name":"web_search"');
  });

  it("admin on + 요청 webSearch=false → web_search 가 미노출(echo 폴백)된다", async () => {
    await setAdminWebSearch(true);
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: USE_WEB_SEARCH, webSearch: false }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("event: tool_use");
    expect(text).toContain("USE_TOOL web_search");
  });

  it("admin off → 요청 webSearch=true 여도 강제 제외된다", async () => {
    await setAdminWebSearch(false);
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: USE_WEB_SEARCH, webSearch: true }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("event: tool_use");
    expect(text).toContain("USE_TOOL web_search");
  });
});

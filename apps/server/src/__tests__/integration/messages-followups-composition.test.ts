// messages-followups-composition.test.ts — P19-T2-04 acceptance: routes/messages.ts 의
// POST /sessions/:id/followups 가 마지막 턴 맥락으로 후속질문 3개를 JSON(SSE 아님)으로
// 반환하는지 createApp(실HTTP, 실 Postgres) 로 검증한다(21-LOOP-LESSONS.md L1 last-mile).
// 이 환경엔 ANTHROPIC_API_KEY 가 없어 dev-stub LLMProvider(echo)가 쓰이므로, 실질적으로
// orchestrator/followups.ts 의 파생 폴백 경로(L5 조용한 실패 금지)를 검증한다.
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

describe("routes/messages.ts 후속질문 제안(followups) — P19-T2-04", () => {
  const org = {
    id: randomUUID(),
    domain: `org-followups-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-followups-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Followups', $2)",
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'followups-test')",
      [id, user.id],
    );
    return id;
  }

  it("직전 턴 뒤 후속질문 3개를 JSON(SSE 아님)으로 반환한다", async () => {
    const sessionId = await createSession();
    const turnRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: authCookie() },
        body: JSON.stringify({ content: "RAG 파이프라인이 뭐야?" }),
      },
    );
    expect(turnRes.status).toBe(200);
    await turnRes.text();

    const res = await app.request(`/api/v1/sessions/${sessionId}/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body.data.followups).toHaveLength(3);
    for (const q of body.data.followups) {
      expect(typeof q).toBe("string");
      expect(q.trim().length).toBeGreaterThan(0);
    }
    expect(body.meta.requestId).toEqual(expect.any(String));
  });

  it("메시지가 없는 새 세션이어도 조용히 실패하지 않고 후속질문 3개를 반환한다(L5)", async () => {
    const sessionId = await createSession();

    const res = await app.request(`/api/v1/sessions/${sessionId}/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: "{}",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.followups).toHaveLength(3);
  });

  it("인증 없이 호출하면 401", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/followups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("cross-org: 타 조직 사용자의 세션을 조회하면 404(대화 내용 노출 차단)", async () => {
    const otherOrg = {
      id: randomUUID(),
      domain: `org-followups-other-${randomUUID()}.example.com`,
    };
    const otherUser = {
      id: randomUUID(),
      email: `user-followups-other-${randomUUID()}@${otherOrg.domain}`,
    };
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Followups Other', $2)",
      [otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [otherUser.id, otherOrg.id, otherUser.email],
    );
    const otherSessionId = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, '비밀 세션')",
      [otherSessionId, otherUser.id],
    );
    await pgPool.query(
      "INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, 'user', $3)",
      [randomUUID(), otherSessionId, JSON.stringify("타조직 비밀 내용")],
    );

    try {
      const res = await app.request(
        `/api/v1/sessions/${otherSessionId}/followups`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: authCookie(),
          },
          body: "{}",
        },
      );
      expect(res.status).toBe(404);
    } finally {
      await pgPool.query("DELETE FROM messages WHERE session_id = $1", [
        otherSessionId,
      ]);
      await pgPool.query("DELETE FROM sessions WHERE id = $1", [
        otherSessionId,
      ]);
      await pgPool.query("DELETE FROM users WHERE id = $1", [otherUser.id]);
      await pgPool.query("DELETE FROM organizations WHERE id = $1", [
        otherOrg.id,
      ]);
    }
  });
});

// messages-title-tags-composition.test.ts — P19-T2-06 acceptance: POST /sessions/:id/messages
// 의 첫 턴 완료 후 세션 title(sessions.title)과 태그(session_tags)가 실제로 갱신되는지
// createApp(실HTTP, 실 Postgres) 로 검증한다(21-LOOP-LESSONS.md L1 last-mile — 유닛
// (orchestrator/session-title-tags.test.ts)만으로는 routes/messages.ts 배선을 보장하지 못함).
// 이 환경엔 ANTHROPIC_API_KEY 가 없어 dev-stub LLMProvider(echo)가 쓰이므로, 실질적으로
// orchestrator/session-title-tags.ts 의 파생 폴백 경로(L5 조용한 실패 금지)를 검증한다.
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

describe("routes/messages.ts 첫 턴 LLM 제목/태그 생성 — P19-T2-06", () => {
  const org = {
    id: randomUUID(),
    domain: `org-title-tags-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-title-tags-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";
  const firstTurnContent = "제목태그테스트";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org TitleTags', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM session_tags WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [user.id],
    );
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

  async function createSession(title: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, user.id, title],
    );
    return id;
  }

  it("첫 턴 완료 후 세션 제목이 파생 폴백으로 갱신되고 태그가 1개 생성된다(dev-stub, L1/L5)", async () => {
    const sessionId = await createSession("최초 제목(수동 삽입)");

    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: firstTurnContent }),
    });
    expect(res.status).toBe(200);
    await res.text();

    const sessionRow = await pgPool.query(
      "SELECT title FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(sessionRow.rows[0].title).toBe(firstTurnContent);

    const tagRows = await pgPool.query(
      "SELECT tag FROM session_tags WHERE session_id = $1",
      [sessionId],
    );
    expect(tagRows.rows).toHaveLength(1);
    expect(tagRows.rows[0].tag).toBe(firstTurnContent);
  });

  it("두 번째 턴에서는 제목/태그를 재생성하지 않는다(최초 턴에만 트리거)", async () => {
    const sessionId = await createSession("최초 제목(수동 삽입) 2");

    const firstRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie(),
        },
        body: JSON.stringify({ content: firstTurnContent }),
      },
    );
    expect(firstRes.status).toBe(200);
    await firstRes.text();

    const secondRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: authCookie(),
        },
        body: JSON.stringify({ content: "두번째 턴 내용은 다르다" }),
      },
    );
    expect(secondRes.status).toBe(200);
    await secondRes.text();

    const sessionRow = await pgPool.query(
      "SELECT title FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(sessionRow.rows[0].title).toBe(firstTurnContent);

    const tagRows = await pgPool.query(
      "SELECT tag FROM session_tags WHERE session_id = $1",
      [sessionId],
    );
    expect(tagRows.rows).toHaveLength(1);
    expect(tagRows.rows[0].tag).toBe(firstTurnContent);
  });
});

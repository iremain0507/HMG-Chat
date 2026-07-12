// app-composition.test.ts — P2-T2-06 acceptance: createApp(env) 부팅 후 실앱 통합 검증.
// 08-SPRINT-PLAN §Phase2 Gate: app.ts 가 routes/{auth,sessions,messages}.ts 를 실제로
// mount 하는지(실서버 404 gap, .ralph/reports/PHASE_REPORT-P2.md 참고) 검증.
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
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

describe("app.ts composition root — P2-T2-06", () => {
  const org = {
    id: randomUUID(),
    domain: `org-ac-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-ac-${randomUUID()}@${org.domain}`,
  };
  const session = { id: randomUUID() };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AC', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'AC')",
      [session.id, user.id],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id = $1",
      [session.id],
    );
    await pgPool.query("DELETE FROM sessions WHERE id = $1", [session.id]);
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

  it("미인증 요청은 401 (authMiddleware 체인)", async () => {
    const res = await app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/sessions/:id/messages → 실앱에서 SSE text_delta+stop", async () => {
    const res = await app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie(),
      },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: text_delta");
    expect(text).toContain("event: stop");
  });

  it("DELETE /api/v1/sessions/:id/active-run → 200 + active_runs.status=cancelled", async () => {
    const postPromise = app.request(`/api/v1/sessions/${session.id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: authCookie(),
      },
      body: JSON.stringify({ content: "hello" }),
    });

    // 핸들러가 run 을 등록하고 dev-stub provider 가 지연 구간에 들어갈 때까지 tick 양보.
    await new Promise((resolve) => setTimeout(resolve, 5));

    const deleteRes = await app.request(
      `/api/v1/sessions/${session.id}/active-run`,
      { method: "DELETE", headers: { Cookie: authCookie() } },
    );
    expect(deleteRes.status).toBe(200);
    const deleteJson = (await deleteRes.json()) as {
      data: { cancelled: boolean };
    };
    expect(deleteJson.data.cancelled).toBe(true);

    const res = await postPromise;
    const text = await res.text();
    expect(text).toContain('"reason":"aborted"');

    const row = await pgPool.query(
      "SELECT status FROM sessions_active_runs WHERE session_id = $1",
      [session.id],
    );
    expect(row.rows[0]?.status).toBe("cancelled");
  });
});

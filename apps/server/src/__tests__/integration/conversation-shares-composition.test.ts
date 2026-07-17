// conversation-shares-composition.test.ts — P20-T1-08 acceptance: routes/conversation-share.ts
// 가 app.ts 에 실제 mount 돼 있는지(POST/:id/share-snapshot, DELETE .../:token,
// GET /api/v1/conversation-shares/:token) + 발급/공개조회/revoke/cross-org 격리를 실 HTTP +
// 실 Postgres 레벨에서 검증(L1 last-mile). public 조회는 authMiddleware 밖 마운트라 쿠키 없이
// 접근 가능함도 함께 검증(routes-mounted.test.ts 의 EXPECTED_ROUTES 주석 참고 — 이 파일이 그
// 실 마운트 검증을 대신한다). 다른 org 세션은 404(existence-leak 방지).
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

describe("app.ts /api/v1/sessions/:id/share-snapshot + /api/v1/conversation-shares mount — P20-T1-08", () => {
  const orgA = {
    id: randomUUID(),
    domain: `org-csc-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-csc-b-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-csc-a-${randomUUID()}@${orgA.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-csc-b-${randomUUID()}@${orgA.domain}`,
  };
  const userC = {
    id: randomUUID(),
    email: `user-csc-c-${randomUUID()}@${orgB.domain}`,
  };
  const session = { id: randomUUID() };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org CSC A', $2), ($3, 'Org CSC B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $7, $8)",
      [
        userA.id,
        orgA.id,
        userA.email,
        userB.id,
        userB.email,
        userC.id,
        orgB.id,
        userC.email,
      ],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, '스냅샷 테스트 세션')",
      [session.id, userA.id],
    );
    await pgPool.query(
      `INSERT INTO messages (session_id, role, content) VALUES
       ($1, 'user', '"안녕하세요"'), ($1, 'assistant', '"안녕하세요! 무엇을 도와드릴까요?"')`,
      [session.id],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM conversation_shares WHERE session_id = $1",
      [session.id],
    );
    await pgPool.query("DELETE FROM messages WHERE session_id = $1", [
      session.id,
    ]);
    await pgPool.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    await pgPool.query("DELETE FROM users WHERE id = ANY($1)", [
      [userA.id, userB.id, userC.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [orgA.id, orgB.id],
    ]);
  });

  function cookieFor(user: { id: string }, org: { id: string }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  it("미인증 POST /api/v1/sessions/:id/share-snapshot → 401", async () => {
    const res = await app.request(
      `/api/v1/sessions/${session.id}/share-snapshot`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(401);
  });

  it("다른 유저는 남의 세션을 스냅샷 공유할 수 없다 (404, existence-leak 방지)", async () => {
    const res = await app.request(
      `/api/v1/sessions/${session.id}/share-snapshot`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(userB, orgA),
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });

  it("소유자 발급 → 공개 조회(쿠키 없이, 스냅샷 메시지 포함) → revoke → 이후 공개 접근 410", async () => {
    const issueRes = await app.request(
      `/api/v1/sessions/${session.id}/share-snapshot`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(userA, orgA),
        },
        body: "{}",
      },
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as {
      data: { token: string; url: string };
    };
    expect(issued.data.url).toContain(
      `/share/conversations/${issued.data.token}`,
    );

    // 공개 조회 — 인증 쿠키 없이 접근 가능(authMiddleware 우회 마운트 검증).
    const publicRes = await app.request(
      `/api/v1/conversation-shares/${issued.data.token}`,
    );
    expect(publicRes.status).toBe(200);
    const publicBody = (await publicRes.json()) as {
      data: {
        title: string | null;
        messages: Array<{ role: string; content: unknown }>;
      };
    };
    expect(publicBody.data.title).toBe("스냅샷 테스트 세션");
    expect(publicBody.data.messages).toHaveLength(2);
    expect(publicBody.data.messages[0].content).toBe("안녕하세요");

    // 원본 세션에 메시지를 추가해도(발급 이후) 공개 스냅샷은 발급 시점 그대로(불변).
    await pgPool.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', '"추가 메시지"')`,
      [session.id],
    );
    const afterInsertRes = await app.request(
      `/api/v1/conversation-shares/${issued.data.token}`,
    );
    const afterInsertBody = (await afterInsertRes.json()) as {
      data: { messages: unknown[] };
    };
    expect(afterInsertBody.data.messages).toHaveLength(2);

    const revokeRes = await app.request(
      `/api/v1/sessions/${session.id}/share-snapshot/${issued.data.token}`,
      { method: "DELETE", headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(revokeRes.status).toBe(204);

    const afterRevokeRes = await app.request(
      `/api/v1/conversation-shares/${issued.data.token}`,
    );
    expect(afterRevokeRes.status).toBe(410);
  });

  it("존재하지 않는 토큰 공개 조회 → 404", async () => {
    const res = await app.request(
      `/api/v1/conversation-shares/${randomUUID()}`,
    );
    expect(res.status).toBe(404);
  });

  it("cross-org 유저는 남의 세션을 스냅샷 공유할 수 없다 (404)", async () => {
    const res = await app.request(
      `/api/v1/sessions/${session.id}/share-snapshot`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(userC, orgB),
        },
        body: "{}",
      },
    );
    expect(res.status).toBe(404);
  });
});

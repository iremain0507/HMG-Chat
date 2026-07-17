// sessions-message-delete-composition.test.ts — P20-T1-05 acceptance: DELETE
// /:id/messages/:mid 가 실 Postgres + createApp(실HTTP) 에서 대상 메시지와 그 하위 서브트리를
// cascade 삭제하고, 형제/무관 메시지는 보존하며, cross-org/타 세션 메시지는 404 인지 검증한다
// (L1 last-mile — 유닛만으로는 마운트/영속/트리 prune 결합을 증명 못 함).
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

describe("routes/sessions.ts DELETE /:id/messages/:mid(app.ts 실 조립) — P20-T1-05", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-msgdel-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-msgdel-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MsgDel A', $2), ($3, 'Org MsgDel B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id IN ($1, $2))",
      [userA.id, userB.id],
    );
    await pgPool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM users WHERE id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [
      orgA.id,
      orgB.id,
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

  async function createSession(title: string, userId: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, userId, title],
    );
    return id;
  }

  async function createMessage(
    sessionId: string,
    content: string,
    parentMessageId: string | null,
  ): Promise<string> {
    const res = await pgPool.query(
      "INSERT INTO messages (session_id, role, content, parent_message_id) VALUES ($1, 'user', $2, $3) RETURNING id",
      [sessionId, JSON.stringify(content), parentMessageId],
    );
    return res.rows[0].id as string;
  }

  async function messageIds(sessionId: string): Promise<string[]> {
    const res = await pgPool.query(
      "SELECT id FROM messages WHERE session_id = $1",
      [sessionId],
    );
    return res.rows.map((r) => r.id as string);
  }

  it("DELETE /:id/messages/:mid 는 대상 메시지와 하위 서브트리를 cascade 삭제하고 무관한 형제는 보존한다", async () => {
    const sessionId = await createSession("tree-delete", userA.id);
    const root = await createMessage(sessionId, "root", null);
    const child = await createMessage(sessionId, "child", root);
    const grandchild = await createMessage(sessionId, "grandchild", child);
    const sibling = await createMessage(sessionId, "sibling", null);

    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${root}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userA, orgA) },
      },
    );
    expect(res.status).toBe(204);

    const remaining = await messageIds(sessionId);
    expect(remaining).not.toContain(root);
    expect(remaining).not.toContain(child);
    expect(remaining).not.toContain(grandchild);
    expect(remaining).toContain(sibling);

    const listRes = await app.request(
      `/api/v1/sessions/${sessionId}/messages`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(listJson.data.some((m) => m.id === root)).toBe(false);
    expect(listJson.data.some((m) => m.id === child)).toBe(false);
    expect(listJson.data.some((m) => m.id === grandchild)).toBe(false);
    expect(listJson.data.some((m) => m.id === sibling)).toBe(true);
  });

  it("DELETE /:id/messages/:mid 는 cross-org — B 가 A 세션의 메시지를 지울 수 없다(404, 메시지 보존)", async () => {
    const sessionId = await createSession("protected-from-b", userA.id);
    const messageId = await createMessage(sessionId, "keep-me", null);

    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userB, orgB) },
      },
    );
    expect(res.status).toBe(404);

    const remaining = await messageIds(sessionId);
    expect(remaining).toContain(messageId);
  });

  it("DELETE /:id/messages/:mid 는 다른 세션 소속 메시지 id 를 주면 404 다(existence-leak 방지)", async () => {
    const sessionId = await createSession("session-one", userA.id);
    const otherSessionId = await createSession("session-two", userA.id);
    const otherMessageId = await createMessage(
      otherSessionId,
      "elsewhere",
      null,
    );

    const res = await app.request(
      `/api/v1/sessions/${sessionId}/messages/${otherMessageId}`,
      {
        method: "DELETE",
        headers: { Cookie: cookieFor(userA, orgA) },
      },
    );
    expect(res.status).toBe(404);

    const remaining = await messageIds(otherSessionId);
    expect(remaining).toContain(otherMessageId);
  });
});

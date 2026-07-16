// sessions-rename-delete-composition.test.ts — P17-T1-03 acceptance(TS-09): PATCH /:id(title) +
// DELETE /:id(cascade) 가 실 Postgres + createApp(실HTTP) 에서 영속·격리되는지 검증한다
// (L1 last-mile — 유닛만으로는 마운트/영속/FK cascade 결합을 증명 못 함).
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

describe("routes/sessions.ts rename/delete(app.ts 실 조립) — P17-T1-03", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-sessrn-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-sessrn-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SessRn A', $2), ($3, 'Org SessRn B', $4)",
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

  async function createSession(title: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, userA.id, title],
    );
    return id;
  }

  it("PATCH /:id 는 title 을 갱신하고 영속한다", async () => {
    const sessionId = await createSession("before-rename");
    const res = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({ title: "after-rename" }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { title: string } };
    expect(json.data.title).toBe("after-rename");

    const row = await pgPool.query("SELECT title FROM sessions WHERE id = $1", [
      sessionId,
    ]);
    expect(row.rows[0].title).toBe("after-rename");
  });

  it("PATCH /:id 는 cross-org — B 가 A 의 세션을 바꿀 수 없다(404)", async () => {
    const sessionId = await createSession("owned-by-a");
    const res = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userB, orgB),
      },
      body: JSON.stringify({ title: "hijacked" }),
    });
    expect(res.status).toBe(404);

    const row = await pgPool.query("SELECT title FROM sessions WHERE id = $1", [
      sessionId,
    ]);
    expect(row.rows[0].title).toBe("owned-by-a");
  });

  it("DELETE /:id 는 204 를 반환하고 messages 를 cascade 삭제하며 목록에서 사라진다", async () => {
    const sessionId = await createSession("to-delete");
    await pgPool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2)",
      [sessionId, JSON.stringify("bye")],
    );

    const res = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(204);

    const sessionRow = await pgPool.query(
      "SELECT id FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(sessionRow.rows).toHaveLength(0);
    const messageRows = await pgPool.query(
      "SELECT id FROM messages WHERE session_id = $1",
      [sessionId],
    );
    expect(messageRows.rows).toHaveLength(0);

    const listRes = await app.request("/api/v1/sessions", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((s) => s.id === sessionId)).toBe(false);
  });

  it("DELETE /:id 는 cross-org — B 가 A 의 세션을 지울 수 없다(404, 세션 보존)", async () => {
    const sessionId = await createSession("protected-from-b");
    const res = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(res.status).toBe(404);

    const row = await pgPool.query("SELECT id FROM sessions WHERE id = $1", [
      sessionId,
    ]);
    expect(row.rows).toHaveLength(1);
  });
});

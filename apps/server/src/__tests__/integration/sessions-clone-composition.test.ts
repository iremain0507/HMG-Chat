// sessions-clone-composition.test.ts — P22-T6-01 acceptance: POST /sessions/:id/clone
// (대화 복제) 가 실 Postgres + createApp(실HTTP) 에서 (1) 원본 메시지 트리를 parentMessageId
// 재매핑해 새 세션에 복사하고 원본은 불변으로 두며 (2) 타 org/user 세션 복제를 404 로 차단하는지
// 검증한다(L1 last-mile — 유닛 fake 만으로는 실제 insert 순서·트리 보존·auth 파생 결합을 증명 못 함).
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

describe("routes/sessions.ts POST /:id/clone(app.ts 실 조립) — P22-T6-01", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-sessclone-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-sessclone-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  const sourceId = randomUUID();
  const m1 = randomUUID();
  const m2 = randomUUID();
  const m3 = randomUUID();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Clone A', $2), ($3, 'Org Clone B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'Clone me')",
      [sourceId, userA.id],
    );
    // 분기 트리: m1(root) → m2 → m3
    await pgPool.query(
      `INSERT INTO messages (id, session_id, role, content, parent_message_id) VALUES
         ($1, $4, 'user', '"질문 1"', NULL),
         ($2, $4, 'assistant', '"답변 1"', $1),
         ($3, $4, 'user', '"질문 2"', $2)`,
      [m1, m2, m3, sourceId],
    );
  });

  afterAll(async () => {
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

  it("소유자가 복제하면 새 세션이 생기고 메시지 트리(부모/자식)가 재매핑된 id 로 보존되며 원본은 불변이다", async () => {
    const res = await app.request(`/api/v1/sessions/${sourceId}/clone`, {
      method: "POST",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; title: string | null };
    };
    expect(json.data.title).toBe("Clone me");
    const newId = json.data.id;
    expect(newId).not.toBe(sourceId);

    // 새 세션 메시지: 내용·순서 동일, id 는 새로 부여, 트리(부모→자식) 보존.
    const cloned = await app.request(`/api/v1/sessions/${newId}/messages`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const clonedJson = (await cloned.json()) as {
      data: Array<{
        id: string;
        content: unknown;
        parentMessageId: string | null;
      }>;
    };
    expect(clonedJson.data).toHaveLength(3);
    expect(clonedJson.data.map((m) => m.content)).toEqual([
      "질문 1",
      "답변 1",
      "질문 2",
    ]);
    // 새 id 는 원본과 겹치지 않음
    const clonedIds = clonedJson.data.map((m) => m.id);
    expect(clonedIds).not.toContain(m1);
    expect(clonedIds).not.toContain(m2);
    expect(clonedIds).not.toContain(m3);
    // 트리 보존: [0] root(null), [1].parent=[0].id, [2].parent=[1].id
    expect(clonedJson.data[0].parentMessageId).toBeNull();
    expect(clonedJson.data[1].parentMessageId).toBe(clonedJson.data[0].id);
    expect(clonedJson.data[2].parentMessageId).toBe(clonedJson.data[1].id);

    // 원본 세션 메시지는 그대로(불변)
    const original = await app.request(
      `/api/v1/sessions/${sourceId}/messages`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const originalJson = (await original.json()) as {
      data: Array<{ id: string }>;
    };
    expect(originalJson.data.map((m) => m.id)).toEqual([m1, m2, m3]);
  });

  it("타 org/user 세션 복제는 404 이고 어떤 세션도 새로 만들지 않는다", async () => {
    const before = await pgPool.query(
      "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1",
      [userB.id],
    );
    const res = await app.request(`/api/v1/sessions/${sourceId}/clone`, {
      method: "POST",
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(res.status).toBe(404);
    const after = await pgPool.query(
      "SELECT count(*)::int AS n FROM sessions WHERE user_id = $1",
      [userB.id],
    );
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("미인증 요청은 401 을 반환한다", async () => {
    const res = await app.request(`/api/v1/sessions/${sourceId}/clone`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

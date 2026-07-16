// session-search-composition.test.ts — P19-T1-06: GET /sessions/search?q= (제목+메시지 내용
// ILIKE, migration 0022 GIN trgm 인덱스)가 실 Postgres + createApp(실HTTP)에서 동작·cross-org
// 격리되는지 검증한다(L1 last-mile — 유닛만으로는 마운트/실쿼리 결합을 증명 못 함).
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

describe("routes/sessions.ts 검색(GET /search?q=, app.ts 실 조립) — P19-T1-06", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-search-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-search-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Search A', $2), ($3, 'Org Search B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
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

  async function createSession(userId: string, title: string): Promise<string> {
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
  ): Promise<void> {
    await pgPool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2::jsonb)",
      [sessionId, JSON.stringify({ text: content })],
    );
  }

  it("제목이 매칭되는 세션을 반환한다", async () => {
    const matching = await createSession(userA.id, "분기별 예산 계획");
    const other = await createSession(userA.id, "무관한 세션");

    const res = await app.request("/api/v1/sessions/search?q=예산", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === matching)).toBe(true);
    expect(json.data.some((s) => s.id === other)).toBe(false);
  });

  it("메시지 내용이 매칭되는 세션을 제목이 무관해도 반환한다", async () => {
    const sessionId = await createSession(userA.id, "제목무관");
    await createMessage(sessionId, "여기 특이한키워드ABC 가 있습니다");

    const res = await app.request("/api/v1/sessions/search?q=특이한키워드ABC", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === sessionId)).toBe(true);
  });

  it("q 가 없으면 400 을 반환한다", async () => {
    const res = await app.request("/api/v1/sessions/search", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(400);
  });

  it("cross-org — B 는 A 의 세션 제목/내용을 검색 결과에서 볼 수 없다", async () => {
    const sessionId = await createSession(userA.id, "A전용예산문서");
    await createMessage(sessionId, "A조직만의비밀키워드");

    const titleRes = await app.request(
      "/api/v1/sessions/search?q=A전용예산문서",
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    const titleJson = (await titleRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(titleJson.data.some((s) => s.id === sessionId)).toBe(false);

    const contentRes = await app.request(
      "/api/v1/sessions/search?q=A조직만의비밀키워드",
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    const contentJson = (await contentRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(contentJson.data.some((s) => s.id === sessionId)).toBe(false);
  });
});

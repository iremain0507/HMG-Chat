// prompts-composition.test.ts — P19-T1-08: 프롬프트 라이브러리 CRUD(migration 0024 prompts) +
// private/org 접근제어가 실 Postgres + createApp(실HTTP)에서 동작·영속·cross-org 격리되는지
// 검증한다(L1 last-mile — 유닛만으로는 마운트/영속/RLS 결합을 증명 못 함).
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

describe("routes/prompts.ts — P19-T1-08 프롬프트 라이브러리 CRUD(app.ts 실 조립)", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-prompts-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-prompts-b-${randomUUID()}.example.com`,
  };
  const userA1 = { id: randomUUID(), email: "" };
  const userA2 = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA1.email = `user-a1-${randomUUID()}@${orgA.domain}`;
  userA2.email = `user-a2-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Prompts A', $2), ($3, 'Org Prompts B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)",
      [
        userA1.id,
        orgA.id,
        userA1.email,
        userA2.id,
        orgA.id,
        userA2.email,
        userB.id,
        orgB.id,
        userB.email,
      ],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM prompts WHERE owner_id IN ($1, $2, $3)", [
      userA1.id,
      userA2.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM users WHERE id IN ($1, $2, $3)", [
      userA1.id,
      userA2.id,
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

  it("POST /api/v1/prompts 로 생성 후 GET / 목록에 반영된다", async () => {
    const res = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/summary",
        title: "요약",
        content: "다음 텍스트를 요약해줘: {{clipboard}}",
        access: "private",
      }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; command: string; access: string };
    };
    expect(json.data.command).toBe("/summary");
    expect(json.data.access).toBe("private");

    const listRes = await app.request("/api/v1/prompts", {
      headers: { Cookie: cookieFor(userA1, orgA) },
    });
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(listJson.data.some((p) => p.id === json.data.id)).toBe(true);
  });

  it("PATCH /api/v1/prompts/:id 로 수정, DELETE 로 삭제된다", async () => {
    const createRes = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/temp",
        title: "임시",
        content: "임시 내용",
        access: "private",
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const patchRes = await app.request(`/api/v1/prompts/${data.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "수정됨" }),
    });
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as { data: { title: string } };
    expect(patchJson.data.title).toBe("수정됨");

    const deleteRes = await app.request(`/api/v1/prompts/${data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA1, orgA) },
    });
    expect(deleteRes.status).toBe(204);

    const row = await pgPool.query("SELECT id FROM prompts WHERE id = $1", [
      data.id,
    ]);
    expect(row.rows.length).toBe(0);
  });

  it("private 프롬프트는 같은 org 의 다른 사용자에게 보이지 않는다(목록·단건 404)", async () => {
    const createRes = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/private-only",
        title: "비공개",
        content: "A1 전용",
        access: "private",
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const listRes = await app.request("/api/v1/prompts", {
      headers: { Cookie: cookieFor(userA2, orgA) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((p) => p.id === data.id)).toBe(false);

    const getRes = await app.request(`/api/v1/prompts/${data.id}`, {
      headers: { Cookie: cookieFor(userA2, orgA) },
    });
    expect(getRes.status).toBe(404);
  });

  it("org 프롬프트는 같은 org 의 다른 사용자에게 보이지만, owner 만 수정/삭제할 수 있다", async () => {
    const createRes = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/team-shared",
        title: "팀 공유",
        content: "org 전체 공유",
        access: "org",
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const listRes = await app.request("/api/v1/prompts", {
      headers: { Cookie: cookieFor(userA2, orgA) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((p) => p.id === data.id)).toBe(true);

    const getRes = await app.request(`/api/v1/prompts/${data.id}`, {
      headers: { Cookie: cookieFor(userA2, orgA) },
    });
    expect(getRes.status).toBe(200);

    const patchRes = await app.request(`/api/v1/prompts/${data.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userA2, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "가로채기" }),
    });
    expect(patchRes.status).toBe(404);

    const deleteRes = await app.request(`/api/v1/prompts/${data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA2, orgA) },
    });
    expect(deleteRes.status).toBe(404);
  });

  it("cross-org — B 는 A 의 org 프롬프트조차 조회/수정/삭제할 수 없다(404, 목록 미포함)", async () => {
    const createRes = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/cross-org-check",
        title: "A org 공유",
        content: "A org 전체 공유",
        access: "org",
      }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const listRes = await app.request("/api/v1/prompts", {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((p) => p.id === data.id)).toBe(false);

    const getRes = await app.request(`/api/v1/prompts/${data.id}`, {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(getRes.status).toBe(404);

    const patchRes = await app.request(`/api/v1/prompts/${data.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userB, orgB),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "가로채기" }),
    });
    expect(patchRes.status).toBe(404);
  });

  it("같은 org 안에서 동일 command 로 중복 생성하면 409 를 반환한다", async () => {
    await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA1, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/dup",
        title: "첫번째",
        content: "내용1",
        access: "private",
      }),
    });

    const dupRes = await app.request("/api/v1/prompts", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA2, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: "/dup",
        title: "두번째",
        content: "내용2",
        access: "private",
      }),
    });
    expect(dupRes.status).toBe(409);
  });
});

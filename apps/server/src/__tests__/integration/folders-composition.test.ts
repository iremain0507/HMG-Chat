// folders-composition.test.ts — P19-T1-03: 세션 폴더 CRUD(migration 0019 session_folders) +
// PATCH /sessions/:id 로 folder_id 할당이 실 Postgres + createApp(실HTTP)에서 동작·영속·
// cross-org 격리되는지 검증한다(L1 last-mile — 유닛만으로는 마운트/영속/RLS 결합을 증명 못 함).
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

describe("routes/folders.ts + sessions.ts folderId 할당(app.ts 실 조립) — P19-T1-03", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-folders-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-folders-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Folders A', $2), ($3, 'Org Folders B', $4)",
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
    await pgPool.query(
      "DELETE FROM session_folders WHERE created_by IN ($1, $2)",
      [userA.id, userB.id],
    );
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

  it("POST /api/v1/folders 로 생성 후 GET / 목록에 반영된다", async () => {
    const res = await app.request("/api/v1/folders", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "업무" }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { data: { id: string; name: string } };
    expect(json.data.name).toBe("업무");

    const listRes = await app.request("/api/v1/folders", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    const listJson = (await listRes.json()) as {
      data: Array<{ id: string; name: string }>;
    };
    expect(listJson.data.some((f) => f.id === json.data.id)).toBe(true);
  });

  it("PATCH /api/v1/folders/:id 로 이름 변경, DELETE 로 삭제된다", async () => {
    const createRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "임시" }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const renameRes = await app.request(`/api/v1/folders/${data.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "이름변경" }),
    });
    expect(renameRes.status).toBe(200);
    const renameJson = (await renameRes.json()) as { data: { name: string } };
    expect(renameJson.data.name).toBe("이름변경");

    const deleteRes = await app.request(`/api/v1/folders/${data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(deleteRes.status).toBe(204);

    const row = await pgPool.query(
      "SELECT id FROM session_folders WHERE id = $1",
      [data.id],
    );
    expect(row.rows.length).toBe(0);
  });

  it("cross-org — B 는 A 의 폴더를 조회/수정/삭제할 수 없다(404)", async () => {
    const createRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "A전용" }),
    });
    const { data } = (await createRes.json()) as { data: { id: string } };

    const patchRes = await app.request(`/api/v1/folders/${data.id}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userB, orgB),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "가로채기" }),
    });
    expect(patchRes.status).toBe(404);

    const deleteRes = await app.request(`/api/v1/folders/${data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(deleteRes.status).toBe(404);

    const listRes = await app.request("/api/v1/folders", {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    const listJson = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(listJson.data.some((f) => f.id === data.id)).toBe(false);
  });

  it("PATCH /api/v1/sessions/:id 로 folderId 할당·해제가 영속된다", async () => {
    const folderRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "세션용" }),
    });
    const { data: folder } = (await folderRes.json()) as {
      data: { id: string };
    };
    const sessionId = await createSession(userA.id, "폴더할당대상");

    const assignRes = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ folderId: folder.id }),
    });
    expect(assignRes.status).toBe(200);
    const assignJson = (await assignRes.json()) as {
      data: { folderId: string | null };
    };
    expect(assignJson.data.folderId).toBe(folder.id);

    const row = await pgPool.query(
      "SELECT folder_id FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(row.rows[0].folder_id).toBe(folder.id);

    const unassignRes = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ folderId: null }),
    });
    expect(unassignRes.status).toBe(200);
    const unassignJson = (await unassignRes.json()) as {
      data: { folderId: string | null };
    };
    expect(unassignJson.data.folderId).toBeNull();
  });

  it("cross-org — B 는 자기 세션에 A 의 폴더를 할당할 수 없다(400)", async () => {
    const folderRes = await app.request("/api/v1/folders", {
      method: "POST",
      headers: {
        Cookie: cookieFor(userA, orgA),
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "A전용세션폴더" }),
    });
    const { data: folder } = (await folderRes.json()) as {
      data: { id: string };
    };
    const sessionId = await createSession(userB.id, "B세션");

    const res = await app.request(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: {
        Cookie: cookieFor(userB, orgB),
        "content-type": "application/json",
      },
      body: JSON.stringify({ folderId: folder.id }),
    });
    expect(res.status).toBe(400);

    const row = await pgPool.query(
      "SELECT folder_id FROM sessions WHERE id = $1",
      [sessionId],
    );
    expect(row.rows[0].folder_id).toBeNull();
  });
});

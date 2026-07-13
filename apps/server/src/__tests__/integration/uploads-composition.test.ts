// uploads-composition.test.ts — P4-T3-01 acceptance: routes/uploads.ts 가 app.ts 에 실제
// mount 돼 있는지 + multipart 업로드 → object-store 저장 → uploads row 생성 → 다운로드 →
// 삭제 흐름을 실 HTTP + 실 Postgres 레벨에서 검증. 다른 유저 업로드 접근 시 existence-leak
// 방지(404) 도 함께 검증 (routes/projects.ts 와 동일 패턴).
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

describe("app.ts /api/v1/uploads mount — P4-T3-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-uc-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-uc-a-${randomUUID()}@${org.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-uc-b-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org UC', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [userA.id, org.id, userA.email, userB.id, userB.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM uploads WHERE user_id = ANY($1)", [
      [userA.id, userB.id],
    ]);
    await pgPool.query("DELETE FROM users WHERE id = ANY($1)", [
      [userA.id, userB.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function cookieFor(user: { id: string }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  function multipartBody(content: string, filename: string): FormData {
    const form = new FormData();
    form.append("file", new File([content], filename, { type: "text/plain" }));
    return form;
  }

  it("미인증 POST /api/v1/uploads → 401", async () => {
    const res = await app.request("/api/v1/uploads", {
      method: "POST",
      body: multipartBody("hello world", "a.txt"),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/uploads → 201 + GET 으로 조회 가능 (downloadUrl 로 원본 바이트 복원)", async () => {
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor(userA) },
      body: multipartBody("hello world", "a.txt"),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      data: { id: string; filename: string; sizeBytes: number };
    };
    expect(created.data.filename).toBe("a.txt");
    expect(created.data.sizeBytes).toBe("hello world".length);

    const getRes = await app.request(`/api/v1/uploads/${created.data.id}`, {
      headers: { Cookie: cookieFor(userA) },
    });
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as { data: { downloadUrl: string } };
    expect(got.data.downloadUrl).toContain(created.data.id);

    const downloadRes = await app.request(got.data.downloadUrl, {
      headers: { Cookie: cookieFor(userA) },
    });
    expect(downloadRes.status).toBe(200);
    expect(await downloadRes.text()).toBe("hello world");
  });

  it("다른 유저는 남의 업로드를 조회/다운로드/삭제할 수 없다 (404, existence-leak 방지)", async () => {
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor(userA) },
      body: multipartBody("secret bytes", "secret.txt"),
    });
    const created = (await createRes.json()) as { data: { id: string } };

    const getRes = await app.request(`/api/v1/uploads/${created.data.id}`, {
      headers: { Cookie: cookieFor(userB) },
    });
    expect(getRes.status).toBe(404);

    const deleteRes = await app.request(`/api/v1/uploads/${created.data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userB) },
    });
    expect(deleteRes.status).toBe(404);
  });

  it("DELETE /api/v1/uploads/:id → 204 + 이후 GET 은 404", async () => {
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor(userA) },
      body: multipartBody("to be deleted", "d.txt"),
    });
    const created = (await createRes.json()) as { data: { id: string } };

    const deleteRes = await app.request(`/api/v1/uploads/${created.data.id}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA) },
    });
    expect(deleteRes.status).toBe(204);

    const getRes = await app.request(`/api/v1/uploads/${created.data.id}`, {
      headers: { Cookie: cookieFor(userA) },
    });
    expect(getRes.status).toBe(404);
  });
});

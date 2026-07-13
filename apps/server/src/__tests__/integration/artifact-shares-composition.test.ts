// artifact-shares-composition.test.ts — P6-T4-01 acceptance: routes/{artifact-shares,public-share}.ts
// 가 app.ts 에 실제 mount 돼 있는지 + 발급/조회/revoke 흐름을 실 HTTP + 실 Postgres 레벨에서
// 검증. public-share 는 authMiddleware 밖(인증 우회) 마운트라 쿠키 없이 접근 가능함도 함께 검증
// (routes-mounted.test.ts 의 EXPECTED_ROUTES 주석 참고 — 이 파일이 그 실 마운트 검증을 대신한다).
// 다른 유저의 artifact 는 404 (existence-leak 방지, routes/uploads.ts 와 동일 패턴).
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

describe("app.ts /api/v1/artifacts/:id/share + /api/v1/share mount — P6-T4-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-asc-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-asc-a-${randomUUID()}@${org.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-asc-b-${randomUUID()}@${org.domain}`,
  };
  const artifact = { id: randomUUID() };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ASC', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [userA.id, org.id, userA.email, userB.id, userB.email],
    );
    await pgPool.query(
      `INSERT INTO artifacts (id, session_id, created_by, type, filename, mime_type, size_bytes, storage_kind, inline_content)
       VALUES ($1, NULL, $2, 'markdown', 'note.md', 'text/markdown', 11, 'inline', 'hello share')`,
      [artifact.id, userA.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM artifact_shares WHERE artifact_id = $1", [
      artifact.id,
    ]);
    await pgPool.query("DELETE FROM artifacts WHERE id = $1", [artifact.id]);
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

  it("미인증 POST /api/v1/artifacts/:id/share → 401", async () => {
    const res = await app.request(`/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("다른 유저는 남의 artifact 를 share 발급/조회할 수 없다 (404, existence-leak 방지)", async () => {
    const res = await app.request(`/api/v1/artifacts/${artifact.id}/share`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor(userB),
      },
      body: "{}",
    });
    expect(res.status).toBe(404);

    const listRes = await app.request(
      `/api/v1/artifacts/${artifact.id}/shares`,
      { headers: { Cookie: cookieFor(userB) } },
    );
    expect(listRes.status).toBe(404);
  });

  it("소유자 발급 → 목록 조회 → 공개 조회/다운로드(쿠키 없이) → revoke → 이후 공개 접근 410", async () => {
    const issueRes = await app.request(
      `/api/v1/artifacts/${artifact.id}/share`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Cookie: cookieFor(userA),
        },
        body: "{}",
      },
    );
    expect(issueRes.status).toBe(201);
    const issued = (await issueRes.json()) as {
      data: { token: string; url: string };
    };
    expect(issued.data.url).toContain(`/share/${issued.data.token}`);

    const listRes = await app.request(
      `/api/v1/artifacts/${artifact.id}/shares`,
      { headers: { Cookie: cookieFor(userA) } },
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ token: string }> };
    expect(list.data.map((s) => s.token)).toContain(issued.data.token);

    // 공개 조회 — 인증 쿠키 없이 접근 가능(authMiddleware 우회 마운트 검증).
    const publicMetaRes = await app.request(
      `/api/v1/share/${issued.data.token}`,
    );
    expect(publicMetaRes.status).toBe(200);
    const publicMeta = (await publicMetaRes.json()) as {
      data: { filename: string; viewCount: number };
    };
    expect(publicMeta.data.filename).toBe("note.md");
    expect(publicMeta.data.viewCount).toBe(0);

    const publicContentRes = await app.request(
      `/api/v1/share/${issued.data.token}/content`,
    );
    expect(publicContentRes.status).toBe(200);
    expect(await publicContentRes.text()).toBe("hello share");

    const afterViewRes = await app.request(
      `/api/v1/share/${issued.data.token}`,
    );
    const afterView = (await afterViewRes.json()) as {
      data: { viewCount: number };
    };
    expect(afterView.data.viewCount).toBe(1);

    const revokeRes = await app.request(
      `/api/v1/artifacts/${artifact.id}/share/${issued.data.token}`,
      { method: "DELETE", headers: { Cookie: cookieFor(userA) } },
    );
    expect(revokeRes.status).toBe(204);

    const afterRevokeRes = await app.request(
      `/api/v1/share/${issued.data.token}`,
    );
    expect(afterRevokeRes.status).toBe(410);
  });
});

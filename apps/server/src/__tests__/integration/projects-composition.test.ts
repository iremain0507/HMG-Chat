// projects-composition.test.ts — P3-T1-03 acceptance: routes/projects.ts 가 app.ts 에 실제
// mount 돼 있는지(독립검증 gap, .ralph/reports/PHASE_REPORT-P3.md 참고) + 다른 org 의 private
// 프로젝트 조회 시 existence-leak 없이 404 를 실 HTTP 레벨에서 반환하는지 검증.
// (project-service.test.ts 는 InMemory ProjectDataAccess 로 권한 매트릭스만 검증 — app.ts 배선
// 자체는 검증하지 않는다, P2-T2-06 과 동일 gap 패턴.)
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

describe("app.ts /api/v1/projects mount — P3-T1-03", () => {
  const orgA = {
    id: randomUUID(),
    domain: `org-pc-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-pc-b-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-pc-a-${randomUUID()}@${orgA.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-pc-b-${randomUUID()}@${orgB.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org PC A', $2), ($3, 'Org PC B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM projects WHERE org_id = ANY($1)", [
      [orgA.id, orgB.id],
    ]);
    await pgPool.query("DELETE FROM users WHERE id = ANY($1)", [
      [userA.id, userB.id],
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

  it("미인증 POST /api/v1/projects → 401", async () => {
    const res = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Nope", visibility: "private" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/projects → 201 + owner 로 GET /api/v1/projects/:id 가능", async () => {
    const createRes = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({ name: "Private A", visibility: "private" }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string } };

    const getRes = await app.request(`/api/v1/projects/${created.data.id}`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(getRes.status).toBe(200);
  });

  it("다른 org 사용자가 private 프로젝트 조회 → 404 (existence-leak 방지)", async () => {
    const createRes = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieFor(userA, orgA),
      },
      body: JSON.stringify({ name: "Private A2", visibility: "private" }),
    });
    const created = (await createRes.json()) as { data: { id: string } };

    const getRes = await app.request(`/api/v1/projects/${created.data.id}`, {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(getRes.status).toBe(404);
  });
});

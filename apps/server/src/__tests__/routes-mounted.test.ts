// routes-mounted.test.ts — 재발 방지 가드.
//   "route 파일은 구현됐지만 app.ts 에 마운트 안 됨" gap 이 P2/P3 에서 연속 발생 →
//   계약상 존재해야 하는 HTTP prefix 가 실제 createApp() 에 마운트됐는지 결정론적으로 검증.
//   원리: 마운트된 경로는 404 가 아닌 응답(401/400/200 등), 미마운트 경로는 404.
//   DB 불필요(authMiddleware/validation 이 라우트 핸들러 이전에 응답) → 기본 `test` 게이트 포함.
//
//   ⚠️ 새 라우트를 추가하는 태스크(P4+ documents/artifacts/memories/mcp-servers ...)는
//      반드시 아래 EXPECTED_ROUTES 에 자기 prefix 를 추가할 것. 그래야 마운트 누락이 이 게이트에서 잡힌다.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createApp } from "../app.js";
import type { Env } from "../env.js";

process.env.JWT_SECRET ??= "test-only-jwt-secret-32chars-minimum-xxxx";

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

const sid = randomUUID();
const pid = randomUUID();

// 계약상 실앱에 마운트돼 있어야 하는 라우트 (16-API-CONTRACT.md 기준). phase 진행 시 추가.
const EXPECTED_ROUTES: Array<{ method: string; path: string; phase: string }> =
  [
    // auth 라우터 마운트 확인은 확실히 존재하는 /me 로 (auth-protected → 401).
    // 주의: 계약(16 §273)의 POST /auth/login(password fallback)은 현재 미구현 — 별도 gap(PROGRESS 기록).
    { method: "GET", path: "/api/v1/auth/me", phase: "P1" },
    { method: "POST", path: `/api/v1/sessions/${sid}/messages`, phase: "P2" },
    {
      method: "DELETE",
      path: `/api/v1/sessions/${sid}/active-run`,
      phase: "P2",
    },
    { method: "GET", path: "/api/v1/projects", phase: "P3" },
    { method: "POST", path: "/api/v1/projects", phase: "P3" },
    { method: "GET", path: `/api/v1/projects/${pid}`, phase: "P3" },
    { method: "POST", path: "/api/v1/uploads", phase: "P4" },
    { method: "GET", path: `/api/v1/uploads/${randomUUID()}`, phase: "P4" },
    { method: "GET", path: `/api/v1/documents?projectId=${pid}`, phase: "P4" },
    { method: "GET", path: `/api/v1/documents/${randomUUID()}`, phase: "P4" },
    { method: "POST", path: "/api/v1/documents", phase: "P4" },
    { method: "GET", path: `/api/v1/artifacts/${randomUUID()}`, phase: "P5" },
    {
      method: "POST",
      path: `/api/v1/artifacts/${randomUUID()}/share`,
      phase: "P6",
    },
    {
      method: "GET",
      path: `/api/v1/artifacts/${randomUUID()}/shares`,
      phase: "P6",
    },
    { method: "GET", path: "/api/v1/memories", phase: "P7" },
    { method: "POST", path: "/api/v1/memories", phase: "P7" },
    // GET /api/v1/share/:token 은 authMiddleware 밖(인증 우회) 이라 "미마운트 404" 와
    // "유효하지 않은 토큰 → 계약상 404 NOT_FOUND"(16-API-CONTRACT § 8) 를 상태코드로 구분할 수
    // 없어 이 가드에서 제외 — 실 마운트 검증은 routes/__tests__/public-share.test.ts(유효 토큰
    // 200 흐름)가 대신한다.
  ];

describe("app.ts route mount 가드 (계약 prefix 배선 검증)", () => {
  const app = createApp(TEST_ENV);

  for (const r of EXPECTED_ROUTES) {
    it(`${r.method} ${r.path} 는 마운트돼 있다 (${r.phase}, 404 아님)`, async () => {
      const res = await app.request(r.path, {
        method: r.method,
        headers: { "content-type": "application/json" },
        body: r.method === "GET" || r.method === "DELETE" ? undefined : "{}",
      });
      expect(
        res.status,
        `${r.method} ${r.path} → ${res.status}. 404 면 app.ts 에 라우트 미마운트.`,
      ).not.toBe(404);
    });
  }
});

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
    { method: "PATCH", path: "/api/v1/auth/me", phase: "P17" },
    { method: "DELETE", path: "/api/v1/auth/me", phase: "P22" },
    { method: "GET", path: "/api/v1/sessions", phase: "P17" },
    { method: "POST", path: "/api/v1/sessions", phase: "P22" },
    { method: "GET", path: `/api/v1/sessions/${sid}`, phase: "P22" },
    { method: "GET", path: `/api/v1/sessions/${sid}/messages`, phase: "P17" },
    { method: "PATCH", path: `/api/v1/sessions/${sid}`, phase: "P17" },
    { method: "DELETE", path: `/api/v1/sessions/${sid}`, phase: "P17" },
    { method: "PATCH", path: `/api/v1/sessions/${sid}/pin`, phase: "P19" },
    { method: "PATCH", path: `/api/v1/sessions/${sid}/archive`, phase: "P19" },
    { method: "POST", path: `/api/v1/sessions/${sid}/clone`, phase: "P22" },
    { method: "POST", path: "/api/v1/sessions/import", phase: "P22" },
    { method: "GET", path: "/api/v1/sessions/search?q=x", phase: "P19" },
    { method: "GET", path: "/api/v1/folders", phase: "P19" },
    { method: "POST", path: "/api/v1/folders", phase: "P19" },
    { method: "GET", path: "/api/v1/prompts", phase: "P19" },
    { method: "POST", path: "/api/v1/prompts", phase: "P19" },
    {
      method: "POST",
      path: `/api/v1/sessions/${sid}/messages/${randomUUID()}/feedback`,
      phase: "P19",
    },
    {
      method: "GET",
      path: `/api/v1/sessions/${sid}/messages/${randomUUID()}/feedback`,
      phase: "P19",
    },
    {
      method: "POST",
      path: `/api/v1/sessions/${sid}/messages/${randomUUID()}/continue`,
      phase: "P19",
    },
    {
      method: "POST",
      path: `/api/v1/sessions/${sid}/followups`,
      phase: "P19",
    },
    { method: "POST", path: `/api/v1/sessions/${sid}/messages`, phase: "P2" },
    {
      method: "DELETE",
      path: `/api/v1/sessions/${sid}/active-run`,
      phase: "P2",
    },
    {
      method: "DELETE",
      path: `/api/v1/sessions/${sid}/messages/${randomUUID()}`,
      phase: "P20",
    },
    { method: "GET", path: "/api/v1/projects", phase: "P3" },
    { method: "POST", path: "/api/v1/projects", phase: "P3" },
    { method: "GET", path: `/api/v1/projects/${pid}`, phase: "P3" },
    { method: "POST", path: "/api/v1/uploads", phase: "P4" },
    { method: "GET", path: `/api/v1/uploads/${randomUUID()}`, phase: "P4" },
    { method: "GET", path: `/api/v1/documents?projectId=${pid}`, phase: "P4" },
    { method: "GET", path: `/api/v1/documents/${randomUUID()}`, phase: "P4" },
    { method: "POST", path: "/api/v1/documents", phase: "P4" },
    {
      method: "POST",
      path: `/api/v1/documents/${randomUUID()}/retry`,
      phase: "P17",
    },
    // P22-T3-02 — 계약(§666-710) nested 경로. flat 은 back-compat 로 유지.
    {
      method: "GET",
      path: `/api/v1/projects/${pid}/documents`,
      phase: "P22",
    },
    {
      method: "POST",
      path: `/api/v1/projects/${pid}/documents`,
      phase: "P22",
    },
    {
      method: "GET",
      path: `/api/v1/projects/${pid}/documents/${randomUUID()}`,
      phase: "P22",
    },
    {
      method: "POST",
      path: `/api/v1/projects/${pid}/documents/${randomUUID()}/retry`,
      phase: "P22",
    },
    {
      method: "DELETE",
      path: `/api/v1/projects/${pid}/documents/${randomUUID()}`,
      phase: "P22",
    },
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
    { method: "GET", path: "/api/v1/mcp-servers", phase: "P8" },
    { method: "POST", path: "/api/v1/mcp-servers", phase: "P8" },
    { method: "GET", path: "/api/v1/openapi-tool-servers", phase: "P22" },
    { method: "POST", path: "/api/v1/openapi-tool-servers", phase: "P22" },
    { method: "GET", path: "/api/v1/agents", phase: "P22" },
    { method: "POST", path: "/api/v1/agents", phase: "P22" },
    { method: "GET", path: `/api/v1/agents/${randomUUID()}`, phase: "P22" },
    { method: "PATCH", path: `/api/v1/agents/${randomUUID()}`, phase: "P22" },
    { method: "DELETE", path: `/api/v1/agents/${randomUUID()}`, phase: "P22" },
    { method: "GET", path: "/api/v1/connections", phase: "P22" },
    { method: "POST", path: "/api/v1/connections", phase: "P22" },
    {
      method: "PATCH",
      path: `/api/v1/connections/${randomUUID()}`,
      phase: "P22",
    },
    {
      method: "DELETE",
      path: `/api/v1/connections/${randomUUID()}`,
      phase: "P22",
    },
    {
      method: "POST",
      path: `/api/v1/connections/${randomUUID()}/verify`,
      phase: "P22",
    },
    { method: "GET", path: "/api/v1/skills", phase: "P8" },
    {
      method: "GET",
      path: "/api/v1/skill-assets/some-skill@1.0.0/asset.png",
      phase: "P8",
    },
    { method: "GET", path: "/api/v1/notifications", phase: "P22" },
    { method: "GET", path: "/api/v1/quota", phase: "P9" },
    { method: "GET", path: "/api/v1/usage/me", phase: "P9" },
    { method: "GET", path: "/api/v1/usage", phase: "P9" },
    { method: "POST", path: "/api/v1/errors", phase: "P9" },
    {
      method: "GET",
      path: "/api/v1/admin/health/history?target=db",
      phase: "P9",
    },
    { method: "GET", path: "/api/v1/config", phase: "P11" },
    { method: "GET", path: "/api/v1/admin/settings", phase: "P14" },
    { method: "PUT", path: "/api/v1/admin/settings", phase: "P14" },
    { method: "GET", path: "/api/v1/admin/models", phase: "P19" },
    { method: "PUT", path: "/api/v1/admin/models", phase: "P19" },
    { method: "GET", path: "/api/v1/admin/tools", phase: "P22" },
    { method: "PUT", path: "/api/v1/admin/tools", phase: "P22" },
    { method: "GET", path: "/api/v1/api-keys", phase: "P19" },
    { method: "POST", path: "/api/v1/api-keys", phase: "P19" },
    { method: "GET", path: "/api/v1/admin/groups", phase: "P19" },
    { method: "POST", path: "/api/v1/admin/groups", phase: "P19" },
    {
      method: "DELETE",
      path: `/api/v1/admin/users/${randomUUID()}`,
      phase: "P20",
    },
    {
      method: "GET",
      path: `/api/v1/admin/grants?resourceType=prompt&resourceId=${randomUUID()}`,
      phase: "P20",
    },
    {
      method: "GET",
      path: `/api/v1/admin/grants?subjectType=group&subjectId=${randomUUID()}`,
      phase: "P22",
    },
    { method: "POST", path: "/api/v1/admin/grants", phase: "P20" },
    {
      method: "DELETE",
      path: `/api/v1/admin/grants?resourceType=prompt&resourceId=${randomUUID()}&subjectType=user&subjectId=${randomUUID()}&access=read`,
      phase: "P20",
    },
    { method: "GET", path: "/api/v1/admin/analytics", phase: "P20" },
    { method: "GET", path: "/api/v1/admin/audit-logs", phase: "P20" },
    {
      method: "POST",
      path: `/api/v1/sessions/${sid}/share-snapshot`,
      phase: "P20",
    },
    {
      method: "DELETE",
      path: `/api/v1/sessions/${sid}/share-snapshot/${randomUUID()}`,
      phase: "P20",
    },
    // GET /api/v1/conversation-shares/:token(P20-T1-08)은 authMiddleware 밖(인증 우회) 이라
    // "미마운트 404" 와 "유효하지 않은 토큰 → 계약상 404 NOT_FOUND" 를 상태코드로 구분할 수 없어
    // 이 가드에서 제외 — 실 마운트 검증은
    // __tests__/integration/conversation-shares-composition.test.ts(유효 토큰 200 흐름)가 대신한다.
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

import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import type {
  MagicLinkTokenRecord,
  Organization,
  RefreshTokenFamilyRecord,
  User,
} from "@wchat/interfaces";
import type { InMemoryEmailSender } from "../../lib/email-sender.js";
import { createAuthRoutes, type AuthDataAccess } from "../auth.js";

process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
process.env.PROJECT_SLUG = "wchat";

// InMemory DataAccess — 09-TDD-GUIDE.md § Mock vs Real 정책: integration test 는
// hono test client + InMemory DataAccess 사용 (실 Postgres 불요).
function makeInMemoryDataAccess(): AuthDataAccess {
  const organizations = new Map<string, Organization>();
  const users = new Map<string, User>();
  const magicLinkTokens = new Map<string, MagicLinkTokenRecord>();
  const refreshTokenFamilies = new Map<string, RefreshTokenFamilyRecord>();

  return {
    organizations: {
      async insert(data) {
        const row = { id: randomUUID(), ...data } as Organization;
        organizations.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = organizations.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        organizations.set(id, updated);
        return updated;
      },
      async delete(id) {
        organizations.delete(id);
      },
      async byId(id) {
        return organizations.get(id) ?? null;
      },
      async list(filter) {
        const items = [...organizations.values()].filter(
          (o) => !filter?.domainEq || o.domain === filter.domainEq,
        );
        return { items };
      },
    },
    users: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          lastLoginAt: null,
          createdAt: new Date(),
          ...data,
        } as User;
        users.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = users.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        users.set(id, updated);
        return updated;
      },
      async delete(id) {
        users.delete(id);
      },
      async byId(id) {
        return users.get(id) ?? null;
      },
      async list(filter) {
        const items = [...users.values()].filter(
          (u) =>
            (!filter?.orgId || u.orgId === filter.orgId) &&
            (!filter?.emailEq || u.email === filter.emailEq),
        );
        return { items };
      },
    },
    magicLinkTokens: {
      async insert(data) {
        const row = {
          usedAt: null,
          createdAt: new Date(),
          ...data,
        } as MagicLinkTokenRecord;
        magicLinkTokens.set(row.tokenHash, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = magicLinkTokens.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        magicLinkTokens.set(id, updated);
        return updated;
      },
      async delete(id) {
        magicLinkTokens.delete(id);
      },
      async byId(id) {
        return magicLinkTokens.get(id) ?? null;
      },
      async byTokenHash(hash) {
        return magicLinkTokens.get(hash) ?? null;
      },
      async markUsed(tokenHash, usedAt) {
        const existing = magicLinkTokens.get(tokenHash);
        if (existing) magicLinkTokens.set(tokenHash, { ...existing, usedAt });
      },
      async expireOlderThan(cutoff) {
        let n = 0;
        for (const [k, v] of magicLinkTokens) {
          if (v.expiresAt < cutoff) {
            magicLinkTokens.delete(k);
            n += 1;
          }
        }
        return n;
      },
      async list(filter) {
        const items = [...magicLinkTokens.values()].filter(
          (t) =>
            (!filter?.email || t.email === filter.email) &&
            (!filter?.intent || t.intent === filter.intent) &&
            (!filter?.unusedOnly || t.usedAt === null),
        );
        return { items };
      },
    },
    refreshTokenFamilies: {
      async insert(data) {
        const row = {
          createdAt: new Date(),
          ...data,
        } as RefreshTokenFamilyRecord;
        refreshTokenFamilies.set(row.familyId, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = refreshTokenFamilies.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        refreshTokenFamilies.set(id, updated);
        return updated;
      },
      async delete(id) {
        refreshTokenFamilies.delete(id);
      },
      async byId(id) {
        return refreshTokenFamilies.get(id) ?? null;
      },
      async byCurrentJti(jti) {
        return (
          [...refreshTokenFamilies.values()].find(
            (f) => f.currentJti === jti,
          ) ?? null
        );
      },
      async rotate(familyId, newJti) {
        const existing = refreshTokenFamilies.get(familyId);
        if (!existing) throw new Error("not found");
        const generation = existing.currentGeneration + 1;
        refreshTokenFamilies.set(familyId, {
          ...existing,
          currentJti: newJti,
          currentGeneration: generation,
          lastUsedAt: new Date(),
        });
        return { generation };
      },
      async revoke(familyId, reason) {
        const existing = refreshTokenFamilies.get(familyId);
        if (existing) {
          refreshTokenFamilies.set(familyId, {
            ...existing,
            revokedAt: new Date(),
            revokeReason: reason,
          });
        }
      },
      async revokeAllForUser(userId, reason) {
        let n = 0;
        for (const [k, v] of refreshTokenFamilies) {
          if (v.userId === userId && !v.revokedAt) {
            refreshTokenFamilies.set(k, {
              ...v,
              revokedAt: new Date(),
              revokeReason: reason,
            });
            n += 1;
          }
        }
        return n;
      },
      async list(filter) {
        const items = [...refreshTokenFamilies.values()].filter(
          (f) =>
            (!filter?.userId || f.userId === filter.userId) &&
            (!filter?.activeOnly || !f.revokedAt),
        );
        return { items };
      },
    },
    async withRlsContext(_ctx, fn) {
      return fn();
    },
  };
}

class InMemoryEmailSenderStub implements InMemoryEmailSender {
  readonly sent: InMemoryEmailSender["sent"] = [];
  async send(input: Parameters<InMemoryEmailSender["send"]>[0]) {
    const result = { messageId: randomUUID(), acceptedAt: new Date() };
    this.sent.push({ ...input, ...result });
    return result;
  }
}

function extractMagicToken(html: string): string {
  const match = html.match(/token=([^"&\s]+)/);
  if (!match) throw new Error("magic link token not found in email body");
  return decodeURIComponent(match[1]);
}

function cookieValue(
  setCookieHeaders: string[],
  name: string,
): string | undefined {
  const line = setCookieHeaders.find((h) => h.startsWith(`${name}=`));
  return line?.split(";")[0]?.split("=")[1];
}

describe("routes/auth", () => {
  let da: AuthDataAccess;
  let emailSender: InMemoryEmailSenderStub;
  let app: ReturnType<typeof createAuthRoutes>;
  let org: Organization;

  beforeEach(async () => {
    da = makeInMemoryDataAccess();
    emailSender = new InMemoryEmailSenderStub();
    app = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
    });
    org = await da.organizations.insert({
      name: "WChat Inc",
      domain: "wchat.example.com",
      plan: "team",
      allowedModels: [],
      allowedTools: [],
      defaultTokenBudgetMicros: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("dev-login: devLogin 미설정(production) → 404", async () => {
    const res = await app.request("/dev-login", { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  it("dev-login: devLogin=true → org 유저로 세션 발급 + 302 홈 redirect + at 쿠키", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const res = await devApp.request("/dev-login", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://localhost:3000/");
    expect(res.headers.get("set-cookie") ?? "").toContain("wchat_at=");
    // dev 유저가 org 안에 생성됨(기존 유저 없을 때).
    const users = await da.users.list({ orgId: org.id });
    expect(users.items.length).toBeGreaterThanOrEqual(1);
  });

  it("도메인 외(gmail.com) 가입 시도 → 403 EMAIL_DOMAIN_FORBIDDEN", async () => {
    const res = await app.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "someone@gmail.com", name: "Someone" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("EMAIL_DOMAIN_FORBIDDEN");
  });

  it("login flow integration: signup → magic-link 발송 → verify → /me → refresh → logout", async () => {
    // 1) signup — 허용 도메인 → magic link 이메일 발송
    const signupRes = await app.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@wchat.example.com",
        name: "New User",
      }),
    });
    expect(signupRes.status).toBe(200);
    const signupBody = await signupRes.json();
    expect(signupBody.data.sent).toBe(true);
    expect(emailSender.sent).toHaveLength(1);
    const rawToken = extractMagicToken(emailSender.sent[0].html);

    // 2) verify — 토큰 클릭 → user 생성 + 302 redirect + cookie set
    const verifyRes = await app.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    expect(verifyRes.status).toBe(302);
    expect(verifyRes.headers.get("location")).toBe("http://localhost:3000/");
    const setCookies = verifyRes.headers.getSetCookie
      ? verifyRes.headers.getSetCookie()
      : [verifyRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");
    const refreshCookie = cookieValue(setCookies, "wchat_rt");
    expect(accessCookie).toBeTruthy();
    expect(refreshCookie).toBeTruthy();

    // signup 으로 새 user 가 생성됨
    const createdUsers = (await da.users.list({ orgId: org.id })).items;
    expect(createdUsers).toHaveLength(1);
    expect(createdUsers[0].email).toBe("new.user@wchat.example.com");

    // 재사용 시 → used 에러로 redirect
    const reuseRes = await app.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    expect(reuseRes.status).toBe(302);
    expect(reuseRes.headers.get("location")).toContain("error=used");

    // 3) /me — access cookie 로 본인 정보 조회
    const meRes = await app.request("/me", {
      headers: { cookie: `wchat_at=${accessCookie}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.user.email).toBe("new.user@wchat.example.com");
    expect(meBody.data.org.domain).toBe("wchat.example.com");

    // 인증 없는 /me → 401
    const unauthMeRes = await app.request("/me");
    expect(unauthMeRes.status).toBe(401);

    // 4) /refresh — refresh cookie 로 rotate
    const refreshRes = await app.request("/refresh", {
      method: "POST",
      headers: { cookie: `wchat_rt=${refreshCookie}` },
    });
    expect(refreshRes.status).toBe(200);
    const refreshSetCookies = refreshRes.headers.getSetCookie
      ? refreshRes.headers.getSetCookie()
      : [refreshRes.headers.get("set-cookie") ?? ""];
    const newRefreshCookie = cookieValue(refreshSetCookies, "wchat_rt");
    expect(newRefreshCookie).toBeTruthy();
    expect(newRefreshCookie).not.toBe(refreshCookie);

    // 이전 세대(rotate 전) refresh token 재사용 → 도난 의심, family revoke + 401
    const stolenRes = await app.request("/refresh", {
      method: "POST",
      headers: { cookie: `wchat_rt=${refreshCookie}` },
    });
    expect(stolenRes.status).toBe(401);
    const families = (
      await da.refreshTokenFamilies.list({ userId: createdUsers[0].id })
    ).items;
    expect(families[0].revokedAt).not.toBeNull();
    expect(families[0].revokeReason).toBe("theft_suspected");

    // 5) /logout — cookie 제거
    const logoutRes = await app.request("/logout", { method: "POST" });
    expect(logoutRes.status).toBe(200);
    const logoutSetCookies = logoutRes.headers.getSetCookie
      ? logoutRes.headers.getSetCookie()
      : [];
    expect(logoutSetCookies.some((c) => c.startsWith("wchat_at=;"))).toBe(true);
  });

  it("만료된 magic-link 토큰 → /login?error=expired 로 redirect", async () => {
    const rawToken = "expired-token-raw";
    await da.magicLinkTokens.insert({
      tokenHash: createHash("sha256").update(rawToken).digest("hex"),
      email: "someone@wchat.example.com",
      userId: null,
      orgId: org.id,
      intent: "signup",
      signupName: "Someone",
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    });
    const res = await app.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("error=expired");
  });
});

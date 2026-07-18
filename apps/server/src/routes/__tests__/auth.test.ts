import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import type {
  MagicLinkTokenRecord,
  Organization,
  RefreshTokenFamilyRecord,
  User,
} from "@wchat/interfaces";
import type { InMemoryEmailSender } from "../../lib/email-sender.js";
import {
  createAuthRoutes,
  type AuthDataAccess,
  type AuthSettingsResolverPort,
} from "../auth.js";
import {
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../../lib/org-settings-schema.js";
// P22-T1-11(C14) — LDAP/AD 디렉터리 로그인 테스트용 dev-stub 클라이언트.
import { createInMemoryLdapDirectoryClient } from "../../lib/ldap-client.js";

process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
process.env.PROJECT_SLUG = "wchat";

// InMemory DataAccess — 09-TDD-GUIDE.md § Mock vs Real 정책: integration test 는
// hono test client + InMemory DataAccess 사용 (실 Postgres 불요).
function makeInMemoryDataAccess(): AuthDataAccess {
  const organizations = new Map<string, Organization>();
  const users = new Map<string, User>();
  const magicLinkTokens = new Map<string, MagicLinkTokenRecord>();
  const refreshTokenFamilies = new Map<string, RefreshTokenFamilyRecord>();
  // P22-T1-13 — email → bcrypt hash. User DTO 와 분리(해시 유출 방지).
  const passwordHashes = new Map<string, string>();

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
      // P22-T1-13(C4) — 비밀번호 로그인 전용 자격증명 조회. 해시는 users Map(User DTO)
      // 밖의 별도 저장소(passwordHashes)에만 둔다 — 실제 DB 도 password_hash 컬럼을
      // User 직렬화에서 제외하므로 동일 구조.
      async credentialsByEmail(email) {
        const normalized = email.trim().toLowerCase();
        const user = [...users.values()].find(
          (u) => u.email.toLowerCase() === normalized,
        );
        if (!user) return null;
        return {
          userId: user.id,
          orgId: user.orgId,
          passwordHash: passwordHashes.get(normalized) ?? null,
        };
      },
    },
    __passwordHashes: passwordHashes,
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

// P22-T1-13 — 비밀번호 로그인 테스트용: users repo 의 credentialsByEmail 이 돌려줄
// (userId, orgId, passwordHash) 를 email 키로 주입한다. User 본체엔 해시를 싣지 않는다
// (계약 C4 원칙: 해시는 DTO 밖, 전용 조회 경로로만).
function seedPasswordHash(
  da: AuthDataAccess,
  email: string,
  hash: string,
): void {
  (
    da as unknown as { __passwordHashes: Map<string, string> }
  ).__passwordHashes.set(email.toLowerCase(), hash);
}

function makeSettingsResolver(
  overrides: Partial<ResolvedOrgSettings>,
): AuthSettingsResolverPort {
  return {
    async resolve() {
      return { ...DEFAULT_ORG_SETTINGS, ...overrides };
    },
  };
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
    // host-보존 상대경로: 브라우저가 접속한 origin(localhost/Tailscale/역프록시)에 상대 해석.
    expect(res.headers.get("location")).toBe("/");
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
    expect(verifyRes.headers.get("location")).toBe("/");
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

  it("P15-T1-01: org enableSignup=false → 허용 도메인이라도 가입 거부(403 SIGNUP_DISABLED)", async () => {
    const gatedApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver({ enableSignup: false }),
    });
    const res = await gatedApp.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "blocked@wchat.example.com",
        name: "Blocked",
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("SIGNUP_DISABLED");
    expect(emailSender.sent).toHaveLength(0);
  });

  it("P15-T1-01: 허용되지 않은 도메인은 enableSignup=true 여도 항상 거부(env 게이트 우선)", async () => {
    const openApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver({ enableSignup: true }),
    });
    const res = await openApp.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "someone@gmail.com", name: "Someone" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("EMAIL_DOMAIN_FORBIDDEN");
  });

  it("P15-T1-01: enableSignup=true(기본) + defaultUserRole=admin → 가입 성공 + 생성 유저 role===admin", async () => {
    const adminRoleApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver({
        enableSignup: true,
        defaultUserRole: "admin",
      }),
    });
    const signupRes = await adminRoleApp.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "future.admin@wchat.example.com",
        name: "Future Admin",
      }),
    });
    expect(signupRes.status).toBe(200);
    const rawToken = extractMagicToken(emailSender.sent[0].html);

    const verifyRes = await adminRoleApp.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    expect(verifyRes.status).toBe(302);

    const created = (
      await da.users.list({
        orgId: org.id,
        emailEq: "future.admin@wchat.example.com",
      })
    ).items[0];
    expect(created).toBeTruthy();
    expect(created.role).toBe("admin");
  });

  it("P15-T1-01: body 에 임의 orgId 를 넣어도 org 는 이메일 도메인으로만 결정된다", async () => {
    const otherOrg = await da.organizations.insert({
      name: "Other Org",
      domain: "other.example.com",
      plan: "team",
      allowedModels: [],
      allowedTools: [],
      defaultTokenBudgetMicros: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "cross.org@wchat.example.com",
        name: "Cross Org",
        orgId: otherOrg.id,
      }),
    });
    expect(res.status).toBe(200);
    const rawToken = extractMagicToken(emailSender.sent[0].html);
    await app.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    const created = (
      await da.users.list({
        orgId: org.id,
        emailEq: "cross.org@wchat.example.com",
      })
    ).items[0];
    expect(created).toBeTruthy();
    const inOtherOrg = (
      await da.users.list({
        orgId: otherOrg.id,
        emailEq: "cross.org@wchat.example.com",
      })
    ).items;
    expect(inOtherOrg).toHaveLength(0);
  });

  it("P17-T1-04: PATCH /me — 인증된 유저가 name·customInstructions 수정 → GET /me 에 반영", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const loginRes = await devApp.request("/dev-login", {
      redirect: "manual",
    });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");

    const patchRes = await devApp.request("/me", {
      method: "PATCH",
      headers: {
        cookie: `wchat_at=${accessCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "Updated Name",
        customInstructions: "항상 한국어로 답해줘",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.name).toBe("Updated Name");
    expect(patchBody.data.customInstructions).toBe("항상 한국어로 답해줘");

    const meRes = await devApp.request("/me", {
      headers: { cookie: `wchat_at=${accessCookie}` },
    });
    const meBody = await meRes.json();
    expect(meBody.data.user.name).toBe("Updated Name");
    expect(meBody.data.user.customInstructions).toBe("항상 한국어로 답해줘");
  });

  // P22-T6-15(C11) — 사용자별 UI 언어(User.language, BCP-47). NULL = 서버 기본(ko).
  // 언어 선택은 localStorage 가 아니라 서버에 영속돼야 재로그인 후에도 유지된다.
  it("P22-T6-15: PATCH /me — language 저장 → GET /me 에 반영(서버 영속)", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const loginRes = await devApp.request("/dev-login", { redirect: "manual" });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");

    const meBefore = await (
      await devApp.request("/me", {
        headers: { cookie: `wchat_at=${accessCookie}` },
      })
    ).json();
    expect(meBefore.data.user.language).toBeNull();

    const patchRes = await devApp.request("/me", {
      method: "PATCH",
      headers: {
        cookie: `wchat_at=${accessCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ language: "en" }),
    });
    expect(patchRes.status).toBe(200);
    expect((await patchRes.json()).data.language).toBe("en");

    const meRes = await devApp.request("/me", {
      headers: { cookie: `wchat_at=${accessCookie}` },
    });
    expect((await meRes.json()).data.user.language).toBe("en");
  });

  it("P22-T6-15: PATCH /me — language null → 서버 기본(ko) 으로 되돌림", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const loginRes = await devApp.request("/dev-login", { redirect: "manual" });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");
    const headers = {
      cookie: `wchat_at=${accessCookie}`,
      "content-type": "application/json",
    };

    await devApp.request("/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: "en" }),
    });
    const cleared = await devApp.request("/me", {
      method: "PATCH",
      headers,
      body: JSON.stringify({ language: null }),
    });
    expect(cleared.status).toBe(200);
    expect((await cleared.json()).data.language).toBeNull();
  });

  it("P22-T6-15: PATCH /me — BCP-47 아닌 language → 400 INVALID_INPUT", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const loginRes = await devApp.request("/dev-login", { redirect: "manual" });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");

    const res = await devApp.request("/me", {
      method: "PATCH",
      headers: {
        cookie: `wchat_at=${accessCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ language: "not a locale!" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("P17-T1-04: PATCH /me — 인증 없이 호출 → 401", async () => {
    const res = await app.request("/me", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(res.status).toBe(401);
  });

  it("P17-T1-04: PATCH /me — name 빈 문자열 → 400 INVALID_INPUT", async () => {
    const devApp = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
    const loginRes = await devApp.request("/dev-login", {
      redirect: "manual",
    });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    const accessCookie = cookieValue(setCookies, "wchat_at");

    const res = await devApp.request("/me", {
      method: "PATCH",
      headers: {
        cookie: `wchat_at=${accessCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  // P22-T1-01 — DELETE /me self-service account deletion (16-API-CONTRACT.md § DELETE /auth/me).
  // 확인문자열 "DELETE_MY_ACCOUNT" 정확 입력 시 202 + status=deleted + 전 세션 강제로그아웃 + 쿠키 삭제.
  function makeDevApp() {
    return createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      devLogin: true,
    });
  }
  async function devLoginCookie(devApp: ReturnType<typeof createAuthRoutes>) {
    const loginRes = await devApp.request("/dev-login", { redirect: "manual" });
    const setCookies = loginRes.headers.getSetCookie
      ? loginRes.headers.getSetCookie()
      : [loginRes.headers.get("set-cookie") ?? ""];
    return cookieValue(setCookies, "wchat_at");
  }

  it("P22-T1-01: DELETE /me — 확인문자열 정확 입력 → 202 + status=deleted + 세션 강제로그아웃 + 쿠키 삭제", async () => {
    const devApp = makeDevApp();
    const accessCookie = await devLoginCookie(devApp);

    const meBefore = await devApp.request("/me", {
      headers: { cookie: `wchat_at=${accessCookie}` },
    });
    const userId = (await meBefore.json()).data.user.id;

    const res = await devApp.request("/me", {
      method: "DELETE",
      headers: {
        cookie: `wchat_at=${accessCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(typeof body.data.ticketId).toBe("string");
    expect(body.data.ticketId.length).toBeGreaterThan(0);
    // scheduledHardDeleteAt ~ now + 30d (허용오차 1분)
    const scheduled = new Date(body.data.scheduledHardDeleteAt).getTime();
    const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Number.isNaN(scheduled)).toBe(false);
    expect(Math.abs(scheduled - expected)).toBeLessThan(60_000);
    expect(typeof body.meta.requestId).toBe("string");

    // 유저 상태가 deleted 로 소프트삭제됨
    const deletedUser = await da.users.byId(userId);
    expect(deletedUser?.status).toBe("deleted");

    // 전 세션 강제 로그아웃 — 활성 refresh family 가 남지 않음
    const families = await da.refreshTokenFamilies.list({
      userId,
      activeOnly: true,
    });
    expect(families.items.length).toBe(0);

    // at/rt 쿠키 삭제(Max-Age=0 또는 만료)
    const clearCookies = res.headers.getSetCookie
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
    expect(clearCookies.some((h) => h.startsWith("wchat_at="))).toBe(true);
    expect(clearCookies.some((h) => h.startsWith("wchat_rt="))).toBe(true);
  });

  it("P22-T1-01: DELETE /me — 확인문자열 누락/오타 → 400 INVALID_CONFIRMATION + 상태 불변", async () => {
    const devApp = makeDevApp();
    const accessCookie = await devLoginCookie(devApp);
    const meBefore = await devApp.request("/me", {
      headers: { cookie: `wchat_at=${accessCookie}` },
    });
    const userId = (await meBefore.json()).data.user.id;

    for (const badBody of [
      {},
      { confirmation: "delete" },
      { confirmation: "" },
    ]) {
      const res = await devApp.request("/me", {
        method: "DELETE",
        headers: {
          cookie: `wchat_at=${accessCookie}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(badBody),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_CONFIRMATION");
    }
    const user = await da.users.byId(userId);
    expect(user?.status).toBe("active");
  });

  // ── P22-T1-13 — POST /auth/login 비밀번호 로그인 (16-API-CONTRACT.md § 1 Auth) ──
  describe("P22-T1-13: POST /login (password)", () => {
    const EMAIL = "pw-user@wchat.example.com";
    const PASSWORD = "correct-horse-battery-staple";
    let userId: string;

    beforeEach(async () => {
      const user = await da.users.insert({
        orgId: org.id,
        email: EMAIL,
        name: "PW User",
        role: "member",
        customInstructions: null,
        status: "active",
        lastLoginAt: null,
      });
      userId = user.id;
      // cost 4 = 테스트 속도용(운영 해시는 migration 0012 주석대로 cost 12).
      seedPasswordHash(da, EMAIL, bcrypt.hashSync(PASSWORD, 4));
    });

    function login(body: unknown, headers: Record<string, string> = {}) {
      return app.request("/login", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    }

    it("올바른 email+password → 200 AuthMeResponse{user,org} + _at/_rt 쿠키", async () => {
      const res = await login({ email: EMAIL, password: PASSWORD });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.user.id).toBe(userId);
      expect(body.data.user.email).toBe(EMAIL);
      expect(body.data.org.id).toBe(org.id);
      // 해시가 응답으로 새지 않는다 (C4 핵심 보안 조건).
      expect(JSON.stringify(body)).not.toContain("$2");
      const cookies = res.headers.getSetCookie();
      expect(cookieValue(cookies, "wchat_at")).toBeTruthy();
      expect(cookieValue(cookies, "wchat_rt")).toBeTruthy();
    });

    it("틀린 password → 401 INVALID_CREDENTIALS + 쿠키 미발급", async () => {
      const res = await login({ email: EMAIL, password: "wrong-password" });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_CREDENTIALS");
      expect(res.headers.getSetCookie()).toHaveLength(0);
    });

    it("존재하지 않는 계정도 동일한 401 INVALID_CREDENTIALS (계정 열거 방지)", async () => {
      const res = await login({
        email: "nobody@wchat.example.com",
        password: PASSWORD,
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_CREDENTIALS");
    });

    it("password_hash 가 NULL(magic-link 전용 계정) → 401 INVALID_CREDENTIALS", async () => {
      await da.users.insert({
        orgId: org.id,
        email: "magic-only@wchat.example.com",
        name: "Magic Only",
        role: "member",
        customInstructions: null,
        status: "active",
        lastLoginAt: null,
      });
      const res = await login({
        email: "magic-only@wchat.example.com",
        password: PASSWORD,
      });
      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
    });

    it("허용되지 않은 도메인 → 403 EMAIL_DOMAIN_FORBIDDEN", async () => {
      const res = await login({
        email: "someone@gmail.com",
        password: PASSWORD,
      });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("EMAIL_DOMAIN_FORBIDDEN");
    });

    it("email/password 누락 → 400 INVALID_INPUT", async () => {
      const res = await login({ email: EMAIL });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe("INVALID_INPUT");
    });

    it("brute-force 임계 초과 → 429 RATE_LIMITED (이후 올바른 비밀번호도 차단)", async () => {
      const limitedApp = createAuthRoutes({
        da,
        emailSender,
        allowedDomains: ["wchat.example.com"],
        appOrigin: "http://localhost:3000",
        secureCookies: false,
        loginRateLimit: { maxAttempts: 3, windowMs: 60_000 },
      });
      const attempt = (password: string) =>
        limitedApp.request("/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: EMAIL, password }),
        });

      for (let i = 0; i < 3; i++) {
        expect((await attempt("wrong-password")).status).toBe(401);
      }
      const blocked = await attempt("wrong-password");
      expect(blocked.status).toBe(429);
      expect((await blocked.json()).error.code).toBe("RATE_LIMITED");
      // 임계 초과 후에는 올바른 비밀번호도 차단된다(계정 보호).
      const stillBlocked = await attempt(PASSWORD);
      expect(stillBlocked.status).toBe(429);
    });

    it("로그인 성공 시 실패 카운터가 리셋된다", async () => {
      const limitedApp = createAuthRoutes({
        da,
        emailSender,
        allowedDomains: ["wchat.example.com"],
        appOrigin: "http://localhost:3000",
        secureCookies: false,
        loginRateLimit: { maxAttempts: 3, windowMs: 60_000 },
      });
      const attempt = (password: string) =>
        limitedApp.request("/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: EMAIL, password }),
        });

      expect((await attempt("wrong-password")).status).toBe(401);
      expect((await attempt("wrong-password")).status).toBe(401);
      expect((await attempt(PASSWORD)).status).toBe(200);
      // 리셋됐으므로 다시 3회까지 401 이어야 한다(2회만에 429 가 되면 리셋 실패).
      expect((await attempt("wrong-password")).status).toBe(401);
      expect((await attempt("wrong-password")).status).toBe(401);
      expect((await attempt("wrong-password")).status).toBe(401);
    });

    it("발급된 세션 쿠키로 GET /me 가 동일 유저를 반환한다(실사용 라운드트립)", async () => {
      const res = await login({ email: EMAIL, password: PASSWORD });
      const at = cookieValue(res.headers.getSetCookie(), "wchat_at");
      const me = await app.request("/me", {
        headers: { cookie: `wchat_at=${at}` },
      });
      expect(me.status).toBe(200);
      expect((await me.json()).data.user.email).toBe(EMAIL);
    });
  });

  it("P22-T1-01: DELETE /me — 인증 없이 호출 → 401 UNAUTHENTICATED", async () => {
    const res = await app.request("/me", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE_MY_ACCOUNT" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });
});

// ── P22-T1-11(계약배치 C14) — LDAP/AD 디렉터리 로그인 ──────────────────────────
// 실 디렉터리 서버는 LOCAL_ONLY 라 in-memory dev-stub 클라이언트를 주입한다.
describe("routes/auth — POST /login/directory (LDAP/AD)", () => {
  const BASE_DN = "ou=People,dc=corp,dc=example,dc=com";
  const ADMIN_GROUP = "cn=wchat-admins,ou=Groups,dc=corp,dc=example,dc=com";
  const STAFF_GROUP = "cn=all-staff,ou=Groups,dc=corp,dc=example,dc=com";
  const LDAP_SETTINGS: Partial<ResolvedOrgSettings> = {
    ldapEnabled: true,
    ldapUrl: "ldaps://dc.corp.example.com:636",
    ldapBindDn: "cn=svc-wchat,dc=corp,dc=example,dc=com",
    ldapBindPasswordRef: "LDAP_BIND_PASSWORD",
    ldapBaseDn: BASE_DN,
    ldapGroupRoleMap: { [ADMIN_GROUP]: "admin", [STAFF_GROUP]: "member" },
  };

  let da: AuthDataAccess;
  let emailSender: InMemoryEmailSenderStub;
  let org: Organization;

  function directoryClient() {
    return createInMemoryLdapDirectoryClient({
      url: "ldaps://dc.corp.example.com:636",
      bindDn: "cn=svc-wchat,dc=corp,dc=example,dc=com",
      bindPassword: "svc-secret",
      entries: [
        {
          dn: `cn=Kim,${BASE_DN}`,
          usernames: ["kim", "kim@wchat.example.com"],
          password: "directory-pw",
          attributes: {
            mail: "kim@wchat.example.com",
            displayName: "김위아",
            memberOf: [ADMIN_GROUP, STAFF_GROUP],
          },
        },
        {
          dn: `cn=Guest,${BASE_DN}`,
          usernames: ["guest"],
          password: "directory-pw",
          attributes: {
            mail: "guest@wchat.example.com",
            displayName: "게스트",
            memberOf: ["cn=guests,ou=Groups,dc=corp,dc=example,dc=com"],
          },
        },
        {
          // baseDn 밖 — 검색범위 밖이라 로그인 불가여야 한다.
          dn: "cn=Contractor,ou=External,dc=corp,dc=example,dc=com",
          usernames: ["contractor"],
          password: "directory-pw",
          attributes: { mail: "contractor@wchat.example.com" },
        },
      ],
    });
  }

  function makeApp(
    overrides: Partial<ResolvedOrgSettings> = LDAP_SETTINGS,
    extra: Partial<Parameters<typeof createAuthRoutes>[0]> = {},
  ) {
    return createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver(overrides),
      directoryClient: directoryClient(),
      env: { LDAP_BIND_PASSWORD: "svc-secret" },
      ...extra,
    });
  }

  function login(
    app: ReturnType<typeof createAuthRoutes>,
    body: Record<string, unknown>,
  ) {
    return app.request("/login/directory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(async () => {
    da = makeInMemoryDataAccess();
    emailSender = new InMemoryEmailSenderStub();
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

  it("ldapEnabled=false(기본값) → 403 DIRECTORY_AUTH_DISABLED (기존 동작 보존)", async () => {
    const res = await login(makeApp({ ldapEnabled: false }), {
      username: "kim",
      password: "directory-pw",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("DIRECTORY_AUTH_DISABLED");
  });

  it("유효한 디렉터리 자격증명 → bind 성공 → 유저 자동 프로비저닝 + 세션 쿠키 발급", async () => {
    const app = makeApp();
    const res = await login(app, { username: "kim", password: "directory-pw" });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.user.email).toBe("kim@wchat.example.com");
    expect(body.data.user.name).toBe("김위아");
    expect(body.data.org.id).toBe(org.id);

    const cookies = res.headers.getSetCookie();
    expect(cookieValue(cookies, "wchat_at")).toBeTruthy();
    expect(cookieValue(cookies, "wchat_rt")).toBeTruthy();

    const created = await da.users.list({ emailEq: "kim@wchat.example.com" });
    expect(created.items).toHaveLength(1);
    expect(created.items[0].orgId).toBe(org.id);
  });

  it("AD 보안그룹 매핑 → org 롤이 그룹에서 파생된다(admins → admin)", async () => {
    const res = await login(makeApp(), {
      username: "kim",
      password: "directory-pw",
    });
    expect((await res.json()).data.user.role).toBe("admin");
  });

  it("이미 존재하는 유저는 중복 생성하지 않고 롤/lastLoginAt 만 갱신한다", async () => {
    const existing = await da.users.insert({
      orgId: org.id,
      email: "kim@wchat.example.com",
      name: "김위아",
      role: "member",
      customInstructions: null,
      status: "active",
      lastLoginAt: null,
    });
    const res = await login(makeApp(), {
      username: "kim",
      password: "directory-pw",
    });
    expect(res.status).toBe(200);
    const all = await da.users.list({ emailEq: "kim@wchat.example.com" });
    expect(all.items).toHaveLength(1);
    const after = await da.users.byId(existing.id);
    expect(after?.role).toBe("admin");
    expect(after?.lastLoginAt).not.toBeNull();
  });

  it("bind 실패(비밀번호 오류) → 401 INVALID_CREDENTIALS", async () => {
    const res = await login(makeApp(), { username: "kim", password: "nope" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("baseDN 밖의 사용자 → 401 INVALID_CREDENTIALS", async () => {
    const res = await login(makeApp(), {
      username: "contractor",
      password: "directory-pw",
    });
    expect(res.status).toBe(401);
  });

  it("매핑된 그룹이 없는 사용자 → 403 DIRECTORY_GROUP_FORBIDDEN (유저 미생성)", async () => {
    const res = await login(makeApp(), {
      username: "guest",
      password: "directory-pw",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("DIRECTORY_GROUP_FORBIDDEN");
    const created = await da.users.list({ emailEq: "guest@wchat.example.com" });
    expect(created.items).toHaveLength(0);
  });

  it("디렉터리 서버 도달 불가 → 503 DIRECTORY_UNAVAILABLE(retryable)", async () => {
    const res = await login(
      makeApp({ ...LDAP_SETTINGS, ldapUrl: "ldaps://unreachable.example.com" }),
      { username: "kim", password: "directory-pw" },
    );
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DIRECTORY_UNAVAILABLE");
    expect(body.error.retryable).toBe(true);
  });

  it("반복 실패는 비밀번호 로그인과 동일한 brute-force 임계로 429", async () => {
    const app = makeApp(LDAP_SETTINGS, {
      loginRateLimit: { maxAttempts: 2, windowMs: 60_000 },
    });
    await login(app, { username: "kim", password: "x" });
    await login(app, { username: "kim", password: "x" });
    const res = await login(app, { username: "kim", password: "directory-pw" });
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("RATE_LIMITED");
  });

  it("디렉터리 이메일 도메인이 허용목록 밖 → 403 EMAIL_DOMAIN_FORBIDDEN", async () => {
    const app = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["other.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver(LDAP_SETTINGS),
      directoryClient: directoryClient(),
      env: { LDAP_BIND_PASSWORD: "svc-secret" },
    });
    const res = await login(app, {
      username: "kim@wchat.example.com",
      password: "directory-pw",
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("EMAIL_DOMAIN_FORBIDDEN");
  });

  it("username/password 누락 → 400 INVALID_INPUT", async () => {
    const res = await login(makeApp(), { username: "kim" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });
});

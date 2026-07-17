// webhook-signup.test.ts — P20-T1-14: 신규가입 Admin Webhook (Slack/Discord dev-stub).
//   RED: adminWebhookUrl 설정된 org 에서 signup→magic-link verify(가입 완료) 시
//   fake dispatcher 가 new_user 페이로드로 1회 호출됨을 단언한다(L1 last-mile: 실 signup
//   라우트 흐름을 태워 실제 email/org 를 담은 payload 를 수신했는지 확인, 유닛이 아님).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
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
import { DEFAULT_ORG_SETTINGS } from "../../lib/org-settings-schema.js";
import { createDevStubWebhookDispatcher } from "../../lib/webhook-dispatcher.js";

process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
process.env.PROJECT_SLUG = "wchat";

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

function makeSettingsResolver(
  adminWebhookUrl: string | undefined,
): AuthSettingsResolverPort {
  return {
    async resolve() {
      return { ...DEFAULT_ORG_SETTINGS, adminWebhookUrl };
    },
  };
}

describe("webhook-signup: 신규가입 Admin Webhook", () => {
  let da: AuthDataAccess;
  let emailSender: InMemoryEmailSenderStub;
  let org: Organization;

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

  async function signupAndVerify(app: ReturnType<typeof createAuthRoutes>) {
    const signupRes = await app.request("/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "new.user@wchat.example.com",
        name: "New User",
      }),
    });
    expect(signupRes.status).toBe(200);
    const rawToken = extractMagicToken(emailSender.sent[0].html);
    const verifyRes = await app.request(
      `/magic-link/verify?token=${encodeURIComponent(rawToken)}`,
      { redirect: "manual" },
    );
    return verifyRes;
  }

  it("adminWebhookUrl 설정된 org 에서 signup 완료 → fake dispatcher 가 new_user 페이로드로 1회 호출됨", async () => {
    const dispatcher = createDevStubWebhookDispatcher();
    const app = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver("https://hooks.example.com/admin"),
      webhookDispatcher: dispatcher,
    });

    const verifyRes = await signupAndVerify(app);
    expect(verifyRes.status).toBe(302);

    expect(dispatcher.calls).toHaveLength(1);
    expect(dispatcher.calls[0].url).toBe("https://hooks.example.com/admin");
    expect(dispatcher.calls[0].payload).toMatchObject({
      event: "new_user",
      orgId: org.id,
      email: "new.user@wchat.example.com",
      name: "New User",
    });
  });

  it("adminWebhookUrl 미설정 org 는 dispatcher 가 호출되지 않는다", async () => {
    const dispatcher = createDevStubWebhookDispatcher();
    const app = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver(undefined),
      webhookDispatcher: dispatcher,
    });

    const verifyRes = await signupAndVerify(app);
    expect(verifyRes.status).toBe(302);
    expect(dispatcher.calls).toHaveLength(0);
  });

  it("dispatcher 가 실패해도 signup 완료 흐름(302 redirect)은 그대로 유지된다(fire-and-forget)", async () => {
    const failingDispatcher = {
      calls: [] as Array<{ url: string; payload: Record<string, unknown> }>,
      async dispatch(url: string, payload: Record<string, unknown>) {
        this.calls.push({ url, payload });
        throw new Error("webhook endpoint unreachable");
      },
    };
    const app = createAuthRoutes({
      da,
      emailSender,
      allowedDomains: ["wchat.example.com"],
      appOrigin: "http://localhost:3000",
      secureCookies: false,
      settings: makeSettingsResolver("https://hooks.example.com/admin"),
      webhookDispatcher: failingDispatcher,
    });

    const verifyRes = await signupAndVerify(app);
    expect(verifyRes.status).toBe(302);
    expect(verifyRes.headers.get("location")).toBe("/");
    expect(failingDispatcher.calls).toHaveLength(1);
  });
});

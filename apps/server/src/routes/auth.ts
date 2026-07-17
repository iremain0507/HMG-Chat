// routes/auth.ts — 16-API-CONTRACT.md § 1 Auth 단일 출처.
// Magic-link 기반 가입/로그인 (password 경로는 packages/interfaces 의 User 타입에
// password_hash 가 노출되지 않아 이 태스크 범위 밖 — PROGRESS.md 참고).
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { DataAccess, EmailSender } from "@wchat/interfaces";
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  type RefreshTokenPayload,
} from "../middleware/jwt.js";
import {
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../lib/org-settings-schema.js";
import type { WebhookDispatcher } from "../lib/webhook-dispatcher.js";

// P15-T1-01 — org-scoped enableSignup/defaultUserRole 조회 포트. settings-service.ts(T1)와
// 동일 계약(resolve)만 의존해 순환을 피한다(messages.ts SettingsResolverPort 와 동일 idiom).
export interface AuthSettingsResolverPort {
  resolve(orgId: string): Promise<ResolvedOrgSettings>;
}

// resolve 미주입/조회 실패 시 절대 throw 하지 않고 DEFAULT_ORG_SETTINGS 로 fail-soft
// (21-LOOP-LESSONS.md L2 — 현재 도메인 게이트만으로 가입 가능하던 기존 동작 보존).
async function resolveAuthSettingsSafely(
  settings: AuthSettingsResolverPort | undefined,
  orgId: string,
): Promise<ResolvedOrgSettings> {
  if (!settings) return DEFAULT_ORG_SETTINGS;
  try {
    return await settings.resolve(orgId);
  } catch {
    return DEFAULT_ORG_SETTINGS;
  }
}

export type AuthDataAccess = Pick<
  DataAccess,
  | "users"
  | "organizations"
  | "magicLinkTokens"
  | "refreshTokenFamilies"
  | "withRlsContext"
>;

export interface AuthRouteDeps {
  da: AuthDataAccess;
  emailSender: EmailSender;
  allowedDomains: string[];
  appOrigin: string; // magic-link 이메일 본문 + 302 redirect 대상 origin (e.g. http://localhost:3000)
  cookiePrefix?: string; // default: process.env.PROJECT_SLUG ?? "wchat"
  magicLinkTtlMinutes?: number; // default 15
  secureCookies?: boolean; // default true (dev/test 에선 false)
  // dev 전용 즉시 로그인(magic-link 없이). production 에선 반드시 false — SSO 도입 전까지 로컬 테스트 편의.
  devLogin?: boolean;
  // P15-T1-01 — org-scoped enableSignup/defaultUserRole 런타임 조회. 미주입 시 DEFAULT_ORG_SETTINGS
  // (enableSignup=true/defaultUserRole=member)로 fail-soft — 기존 동작 보존.
  settings?: AuthSettingsResolverPort;
  // P20-T1-14 — 신규가입 완료 시 org.adminWebhookUrl 설정돼 있으면 new_user 페이로드를
  // fire-and-forget 으로 전달(미주입/미설정 시 미발송, 인증흐름은 절대 차단하지 않음).
  webhookDispatcher?: WebhookDispatcher;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

function emailDomain(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function errorJson(
  code: string,
  message: string,
  retryable = false,
): {
  error: {
    code: string;
    category: "auth";
    message: string;
    retryable: boolean;
  };
} {
  return { error: { code, category: "auth", message, retryable } };
}

export function createAuthRoutes(deps: AuthRouteDeps): Hono {
  const app = new Hono();
  const cookiePrefix = deps.cookiePrefix ?? process.env.PROJECT_SLUG ?? "wchat";
  const atCookie = `${cookiePrefix}_at`;
  const rtCookie = `${cookiePrefix}_rt`;
  const ttlMinutes = deps.magicLinkTtlMinutes ?? 15;
  const secure = deps.secureCookies ?? true;

  async function findOrgByDomain(domain: string) {
    const page = await deps.da.organizations.list({ domainEq: domain });
    return page.items[0] ?? null;
  }

  // 브라우저 네비게이션 302 는 host-보존 상대경로로 준다: 브라우저가 주소창 origin
  //   (localhost / Tailscale MagicDNS / 역프록시 도메인 무엇이든)에 상대해 해석하므로
  //   APP_ORIGIN 하드코딩(localhost:3000)으로 외부 접속이 튕기지 않는다. (email 내
  //   magic-link 본문만 절대 appOrigin 을 쓴다 — 메일 클라이언트엔 base URL 이 없음.)
  function loginUrl(error?: string): string {
    return error ? `/login?error=${error}` : `/login`;
  }

  async function issueSession(
    c: Context,
    userId: string,
    orgId: string,
    role: "member" | "admin" | "owner",
  ) {
    const familyId = randomUUID();
    const refreshToken = signRefreshToken({ userId, familyId });
    const { jti } = jwt.decode(refreshToken) as RefreshTokenPayload;
    await deps.da.refreshTokenFamilies.insert({
      familyId,
      userId,
      currentGeneration: 0,
      currentJti: jti,
      lastUsedAt: new Date(),
      revokedAt: null,
      revokeReason: null,
    });
    const accessToken = signAccessToken({ userId, orgId, role });

    setCookie(c, atCookie, accessToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: ACCESS_TTL_SECONDS,
    });
    setCookie(c, rtCookie, refreshToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/v1/auth/refresh",
      maxAge: REFRESH_TTL_SECONDS,
    });
  }

  async function authenticate(c: Context) {
    const token = getCookie(c, atCookie);
    if (!token) return null;
    try {
      return verifyAccessToken(token);
    } catch {
      return null;
    }
  }

  app.post("/signup", async (c) => {
    const body = await c.req
      .json<{ email?: string; name?: string }>()
      .catch(() => ({}) as { email?: string; name?: string });
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!email || !isValidEmail(email) || !name) {
      return c.json(
        errorJson("INVALID_INPUT", "이메일/이름을 확인하세요."),
        400,
      );
    }
    const domain = emailDomain(email);
    if (!deps.allowedDomains.includes(domain)) {
      return c.json(
        errorJson(
          "EMAIL_DOMAIN_FORBIDDEN",
          `${deps.allowedDomains.join(", ")} 도메인만 가입 가능합니다.`,
        ),
        403,
      );
    }
    const org = await findOrgByDomain(domain);
    if (!org) {
      return c.json(
        errorJson("EMAIL_DOMAIN_FORBIDDEN", "등록된 조직을 찾을 수 없습니다."),
        403,
      );
    }

    // org 는 오직 이메일 도메인으로만 결정된다(body 로 지정 불가) — enableSignup 도
    // 이 org 기준으로만 조회한다.
    const resolved = await resolveAuthSettingsSafely(deps.settings, org.id);
    if (!resolved.enableSignup) {
      return c.json(
        errorJson("SIGNUP_DISABLED", "이 조직은 가입이 비활성화되어 있습니다."),
        403,
      );
    }

    const rawToken = randomBytes(32).toString("base64url");
    await deps.da.magicLinkTokens.insert({
      tokenHash: hashToken(rawToken),
      email,
      userId: null,
      orgId: org.id,
      intent: "signup",
      signupName: name,
      expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      usedAt: null,
    });
    await deps.emailSender.send({
      to: email,
      subject: "WChat 가입 확인",
      html: `<p>가입을 완료하려면 링크를 클릭하세요:</p><p><a href="${deps.appOrigin}/api/v1/auth/magic-link/verify?token=${encodeURIComponent(rawToken)}">가입 완료</a></p>`,
      category: "auth",
      idempotencyKey: hashToken(rawToken),
    });

    return c.json({ data: { sent: true }, meta: { requestId: randomUUID() } });
  });

  app.post("/magic-link", async (c) => {
    const body = await c.req
      .json<{ email?: string }>()
      .catch(() => ({}) as { email?: string });
    const email = body.email?.trim().toLowerCase();
    // enumeration 방지: 입력 오류가 아닌 한 항상 { sent: true } — 08-SPRINT-PLAN 부수효과 참고.
    if (email && isValidEmail(email)) {
      const domain = emailDomain(email);
      if (deps.allowedDomains.includes(domain)) {
        const org = await findOrgByDomain(domain);
        const existing = org
          ? (await deps.da.users.list({ orgId: org.id, emailEq: email }))
              .items[0]
          : undefined;
        if (org && existing) {
          const rawToken = randomBytes(32).toString("base64url");
          await deps.da.magicLinkTokens.insert({
            tokenHash: hashToken(rawToken),
            email,
            userId: existing.id,
            orgId: org.id,
            intent: "login",
            signupName: null,
            expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
            usedAt: null,
          });
          await deps.emailSender.send({
            to: email,
            subject: "WChat 로그인",
            html: `<p>로그인하려면 링크를 클릭하세요:</p><p><a href="${deps.appOrigin}/api/v1/auth/magic-link/verify?token=${encodeURIComponent(rawToken)}">로그인</a></p>`,
            category: "auth",
            idempotencyKey: hashToken(rawToken),
          });
        }
      }
    }
    return c.json({ data: { sent: true }, meta: { requestId: randomUUID() } });
  });

  app.get("/magic-link/verify", async (c) => {
    const token = c.req.query("token");
    if (!token) return c.redirect(loginUrl("invalid"), 302);

    const hash = hashToken(token);
    const record = await deps.da.magicLinkTokens.byTokenHash(hash);
    if (!record) return c.redirect(loginUrl("invalid"), 302);
    if (record.usedAt) return c.redirect(loginUrl("used"), 302);
    if (record.expiresAt.getTime() < Date.now()) {
      return c.redirect(loginUrl("expired"), 302);
    }

    let userId = record.userId;
    if (record.intent === "signup" && !userId) {
      const resolved = await resolveAuthSettingsSafely(
        deps.settings,
        record.orgId,
      );
      const user = await deps.da.users.insert({
        orgId: record.orgId,
        email: record.email,
        name: record.signupName,
        // exactOptionalPropertyTypes: ResolvedOrgSettings 필드는 zod `.optional()` 유래
        // `| undefined` 가 Required<> 에도 남는다(messages.ts SAFE_DEFAULT_MAX_TOKENS 와 동일 사유).
        role: resolved.defaultUserRole ?? "member",
        customInstructions: null,
        status: "active",
        lastLoginAt: new Date(),
      });
      userId = user.id;

      // P20-T1-14 — fire-and-forget: dispatch 실패해도 가입 완료(세션 발급) 흐름은 계속된다.
      if (resolved.adminWebhookUrl && deps.webhookDispatcher) {
        deps.webhookDispatcher
          .dispatch(resolved.adminWebhookUrl, {
            event: "new_user",
            orgId: record.orgId,
            email: user.email,
            name: user.name,
            createdAt: user.createdAt.toISOString(),
          })
          .catch(() => {});
      }
    }
    if (!userId) return c.redirect(loginUrl("invalid"), 302);

    await deps.da.magicLinkTokens.markUsed(hash, new Date());

    const user = await deps.da.users.byId(userId);
    if (!user) return c.redirect(loginUrl("invalid"), 302);

    await issueSession(c, user.id, user.orgId, user.role);
    return c.redirect("/", 302);
  });

  // dev 전용 즉시 로그인 — magic-link 없이 세션 발급 후 홈으로 302.
  //   GET /api/v1/auth/dev-login[?email=you@allowed-domain]
  //   production(devLogin=false) 에선 404. 향후 SSO 로 교체될 로컬 테스트 편의 경로.
  app.get("/dev-login", async (c) => {
    if (!deps.devLogin) {
      return c.json(
        errorJson(
          "NOT_FOUND",
          "dev-login 은 개발 환경에서만 사용할 수 있습니다.",
        ),
        404,
      );
    }
    const requestedEmail = c.req.query("email")?.trim().toLowerCase();
    const domain =
      requestedEmail && isValidEmail(requestedEmail)
        ? emailDomain(requestedEmail)
        : (deps.allowedDomains[0] ?? "");
    let org = await findOrgByDomain(domain);
    if (!org) {
      // dev 전용: allowed-domain org 가 없으면 생성 — fresh DB 에서도 시드 없이 접속.
      org = await deps.da.organizations.insert({
        name: "Dev Org",
        domain,
        plan: "team",
        allowedModels: [
          "claude-sonnet-5",
          "claude-opus-4-8",
          "claude-haiku-4-5",
        ],
        allowedTools: [],
        defaultTokenBudgetMicros: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    // 요청 email 유저 → 없으면 org 의 기존 유저 → 그래도 없으면 owner dev 유저 생성.
    let user = requestedEmail
      ? (await deps.da.users.list({ orgId: org.id, emailEq: requestedEmail }))
          .items[0]
      : undefined;
    if (!user) {
      user = (await deps.da.users.list({ orgId: org.id })).items[0];
    }
    if (!user) {
      user = await deps.da.users.insert({
        orgId: org.id,
        email: requestedEmail ?? `dev@${domain}`,
        name: "Dev User",
        role: "owner",
        customInstructions: null,
        status: "active",
        lastLoginAt: new Date(),
      });
    }
    await issueSession(c, user.id, user.orgId, user.role);
    return c.redirect("/", 302);
  });

  app.get("/me", async (c) => {
    const auth = await authenticate(c);
    if (!auth) {
      return c.json(errorJson("UNAUTHENTICATED", "로그인이 필요합니다."), 401);
    }
    const user = await deps.da.users.byId(auth.sub);
    if (!user) {
      return c.json(
        errorJson("UNAUTHENTICATED", "사용자를 찾을 수 없습니다."),
        401,
      );
    }
    const org = await deps.da.organizations.byId(user.orgId);
    if (!org) {
      return c.json(
        errorJson("UNAUTHENTICATED", "조직을 찾을 수 없습니다."),
        401,
      );
    }
    return c.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          orgId: user.orgId,
          role: user.role,
          customInstructions: user.customInstructions,
          createdAt: user.createdAt.toISOString(),
        },
        org: {
          id: org.id,
          name: org.name,
          domain: org.domain,
          plan: org.plan,
          allowedModels: org.allowedModels,
          allowedTools: org.allowedTools,
          defaultTokenBudgetMicros: org.defaultTokenBudgetMicros,
          createdAt: org.createdAt.toISOString(),
          updatedAt: org.updatedAt.toISOString(),
        },
      },
      meta: { requestId: randomUUID() },
    });
  });

  // P17-T1-04(TS-20) — 본인 프로필 수정. 16-API-CONTRACT.md § PATCH /auth/me:
  // name(1~100자)·customInstructions(null=제거, max 2000자) 부분 갱신, 갱신된 User 반환.
  app.patch("/me", async (c) => {
    const auth = await authenticate(c);
    if (!auth) {
      return c.json(errorJson("UNAUTHENTICATED", "로그인이 필요합니다."), 401);
    }
    const body = await c.req
      .json<{ name?: string; customInstructions?: string | null }>()
      .catch(
        () => ({}) as { name?: string; customInstructions?: string | null },
      );

    const patch: { name?: string; customInstructions?: string | null } = {};
    if (body.name !== undefined) {
      const trimmed = body.name.trim();
      if (trimmed.length < 1 || trimmed.length > 100) {
        return c.json(
          errorJson("INVALID_INPUT", "이름은 1~100자여야 합니다."),
          400,
        );
      }
      patch.name = trimmed;
    }
    if (body.customInstructions !== undefined) {
      if (
        body.customInstructions !== null &&
        body.customInstructions.length > 2000
      ) {
        return c.json(
          errorJson(
            "INVALID_INPUT",
            "customInstructions 는 최대 2000자입니다.",
          ),
          400,
        );
      }
      patch.customInstructions = body.customInstructions;
    }

    const updated = await deps.da.users.update(auth.sub, patch);
    return c.json({
      data: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        orgId: updated.orgId,
        role: updated.role,
        customInstructions: updated.customInstructions,
        createdAt: updated.createdAt.toISOString(),
      },
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/logout", (c) => {
    deleteCookie(c, atCookie, { path: "/" });
    deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });
    return c.json({ data: { ok: true }, meta: { requestId: randomUUID() } });
  });

  app.post("/refresh", async (c) => {
    const token = getCookie(c, rtCookie);
    if (!token) {
      return c.json(
        errorJson("UNAUTHENTICATED", "refresh token 이 없습니다."),
        401,
        {
          "WWW-Authenticate": "re-login",
        },
      );
    }

    let payload: RefreshTokenPayload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      deleteCookie(c, atCookie, { path: "/" });
      deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });
      return c.json(
        errorJson("UNAUTHENTICATED", "refresh token 이 유효하지 않습니다."),
        401,
        {
          "WWW-Authenticate": "re-login",
        },
      );
    }

    const family = await deps.da.refreshTokenFamilies.byId(payload.family);
    if (!family || family.revokedAt) {
      deleteCookie(c, atCookie, { path: "/" });
      deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });
      return c.json(
        errorJson("UNAUTHENTICATED", "refresh 세션이 만료되었습니다."),
        401,
        {
          "WWW-Authenticate": "re-login",
        },
      );
    }

    if (family.currentJti !== payload.jti) {
      // 이전 generation 의 token 재사용 = 도난 의심 (12-OPS-SECURITY § 부록 A).
      await deps.da.refreshTokenFamilies.revoke(
        family.familyId,
        "theft_suspected",
      );
      deleteCookie(c, atCookie, { path: "/" });
      deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });
      return c.json(
        errorJson(
          "REFRESH_TOKEN_REUSED",
          "도난이 의심되어 세션이 강제 종료되었습니다.",
        ),
        401,
        { "WWW-Authenticate": "re-login" },
      );
    }

    const user = await deps.da.users.byId(family.userId);
    if (!user) {
      return c.json(
        errorJson("UNAUTHENTICATED", "사용자를 찾을 수 없습니다."),
        401,
        {
          "WWW-Authenticate": "re-login",
        },
      );
    }

    const newRefreshToken = signRefreshToken({
      userId: user.id,
      familyId: family.familyId,
    });
    const { jti: newJti } = jwt.decode(newRefreshToken) as RefreshTokenPayload;
    await deps.da.refreshTokenFamilies.rotate(family.familyId, newJti);
    const newAccessToken = signAccessToken({
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
    });

    setCookie(c, atCookie, newAccessToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/",
      maxAge: ACCESS_TTL_SECONDS,
    });
    setCookie(c, rtCookie, newRefreshToken, {
      httpOnly: true,
      secure,
      sameSite: "Lax",
      path: "/api/v1/auth/refresh",
      maxAge: REFRESH_TTL_SECONDS,
    });

    return c.json({ data: { ok: true }, meta: { requestId: randomUUID() } });
  });

  return app;
}

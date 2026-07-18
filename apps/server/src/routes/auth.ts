// routes/auth.ts — 16-API-CONTRACT.md § 1 Auth 단일 출처.
// Magic-link 기반 가입/로그인 + P22-T1-13(계약배치 C4) 비밀번호 로그인(POST /login).
// 해시는 UserRepo.credentialsByEmail 로만 읽고 User DTO 에는 싣지 않는다.
import { Hono, type Context } from "hono";
import bcrypt from "bcryptjs";
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
  // P22-T1-13 — POST /login brute-force 임계. 미주입 시 DEFAULT_LOGIN_RATE_LIMIT.
  loginRateLimit?: { maxAttempts: number; windowMs: number };
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

// P22-T1-13 — 계약(16 § POST /auth/login) 429 RATE_LIMITED 임계. 프로세스 로컬 카운터
// (단일 인스턴스 기준). 다중 인스턴스 배포 시 Redis 백엔드로 교체 대상.
const DEFAULT_LOGIN_RATE_LIMIT = { maxAttempts: 10, windowMs: 15 * 60_000 };

// 존재하지 않는 계정/해시 없는 계정에도 동일한 bcrypt 비용을 지불해 응답시간으로
// 계정 존재 여부가 새지 않게 한다(계정 열거 방지). cost 는 migration 0012 와 동일한 12.
const DUMMY_BCRYPT_HASH =
  "$2a$12$C6UzMDM.H6dfI/f/IKcEe.ANRXCPHZOwRRVPelE6TZ0Y6nQoQvY9O";

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

  // ── P22-T1-13 — POST /login (16-API-CONTRACT.md § 1 Auth) ──
  // EMAIL_SENDER_KIND=noop 등 magic-link 를 못 쓰는 환경의 admin/dev 로그인 경로.
  // 400 INVALID_INPUT / 401 INVALID_CREDENTIALS / 403 EMAIL_DOMAIN_FORBIDDEN / 429 RATE_LIMITED.
  const loginLimit = deps.loginRateLimit ?? DEFAULT_LOGIN_RATE_LIMIT;
  const loginFailures = new Map<string, { count: number; firstAt: number }>();

  function rateLimited(key: string): boolean {
    const entry = loginFailures.get(key);
    if (!entry) return false;
    if (Date.now() - entry.firstAt >= loginLimit.windowMs) {
      loginFailures.delete(key);
      return false;
    }
    return entry.count >= loginLimit.maxAttempts;
  }

  function recordFailure(key: string): void {
    const entry = loginFailures.get(key);
    if (!entry || Date.now() - entry.firstAt >= loginLimit.windowMs) {
      loginFailures.set(key, { count: 1, firstAt: Date.now() });
      return;
    }
    entry.count += 1;
  }

  app.post("/login", async (c) => {
    const body = await c.req
      .json<{ email?: string; password?: string }>()
      .catch(() => ({}) as { email?: string; password?: string });
    const email = body.email?.trim().toLowerCase();
    const password = body.password;
    if (!email || !isValidEmail(email) || !password) {
      return c.json(
        errorJson("INVALID_INPUT", "이메일/비밀번호를 확인하세요."),
        400,
      );
    }

    // 도메인 게이트는 rate-limit 보다 먼저 — 계약상 403 이 우선이고, 허용되지 않은
    // 도메인은 어차피 자격증명 조회에 도달하지 않는다.
    if (!deps.allowedDomains.includes(emailDomain(email))) {
      return c.json(
        errorJson(
          "EMAIL_DOMAIN_FORBIDDEN",
          `${deps.allowedDomains.join(", ")} 도메인만 로그인 가능합니다.`,
        ),
        403,
      );
    }

    if (rateLimited(email)) {
      return c.json(
        errorJson(
          "RATE_LIMITED",
          "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
          true,
        ),
        429,
      );
    }

    const credentials = await deps.da.users.credentialsByEmail(email);
    // 계정 부재/해시 부재여도 더미 해시로 동일한 시간을 소모(계정 열거 방지).
    const matched = await bcrypt.compare(
      password,
      credentials?.passwordHash ?? DUMMY_BCRYPT_HASH,
    );
    if (!credentials?.passwordHash || !matched) {
      recordFailure(email);
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "이메일 또는 비밀번호가 올바르지 않습니다.",
        ),
        401,
      );
    }

    const user = await deps.da.users.byId(credentials.userId);
    const org = user ? await deps.da.organizations.byId(user.orgId) : null;
    if (!user || !org) {
      recordFailure(email);
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "이메일 또는 비밀번호가 올바르지 않습니다.",
        ),
        401,
      );
    }

    loginFailures.delete(email);
    await deps.da.users.update(user.id, { lastLoginAt: new Date() });
    await issueSession(c, user.id, user.orgId, user.role);

    return c.json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          orgId: user.orgId,
          role: user.role,
          customInstructions: user.customInstructions,
          // P22-T6-15(C11) — UI 언어. null = 서버 기본(ko).
          language: user.language ?? null,
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
        language: null,
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
        language: null,
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
          // P22-T6-15(C11) — UI 언어. null = 서버 기본(ko).
          language: user.language ?? null,
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
    type MePatchBody = {
      name?: string;
      customInstructions?: string | null;
      language?: string | null;
    };
    const body = await c.req
      .json<MePatchBody>()
      .catch(() => ({}) as MePatchBody);

    const patch: {
      name?: string;
      customInstructions?: string | null;
      language?: string | null;
    } = {};
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
    // P22-T6-15(C11) — UI 언어. null = 서버 기본(ko) 으로 되돌림.
    // migration 0036 의 CHECK 제약과 동일한 BCP-47 형태만 허용(이중 방어).
    if (body.language !== undefined) {
      if (
        body.language !== null &&
        !/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(body.language)
      ) {
        return c.json(
          errorJson("INVALID_INPUT", "language 는 BCP-47 태그여야 합니다."),
          400,
        );
      }
      patch.language = body.language;
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
        language: updated.language ?? null,
        createdAt: updated.createdAt.toISOString(),
      },
      meta: { requestId: randomUUID() },
    });
  });

  // P22-T1-01(GDPR) — 본인 계정 자율 삭제. 16-API-CONTRACT.md § DELETE /auth/me:
  // 확인문자열 "DELETE_MY_ACCOUNT" 정확 입력 → 202 { scheduledHardDeleteAt(now+30d), ticketId }.
  // 즉시: status='deleted' 소프트삭제 + 전 세션 강제 로그아웃(revokeAllForUser) + at/rt 쿠키 삭제.
  // 30일 grace 후 hard-delete cascade 는 별도 백그라운드 잡(migration 필요) — 이 라우트는 in-plan 범위만.
  app.delete("/me", async (c) => {
    const auth = await authenticate(c);
    if (!auth) {
      return c.json(errorJson("UNAUTHENTICATED", "로그인이 필요합니다."), 401);
    }
    const body = await c.req
      .json<{ confirmation?: string }>()
      .catch(() => ({}) as { confirmation?: string });
    if (body.confirmation !== "DELETE_MY_ACCOUNT") {
      return c.json(
        errorJson(
          "INVALID_CONFIRMATION",
          "삭제를 확정하려면 확인문자열 'DELETE_MY_ACCOUNT' 을 정확히 입력하세요.",
        ),
        400,
      );
    }

    await deps.da.withRlsContext(
      { userId: auth.sub, orgId: auth.org },
      async () => {
        await deps.da.users.update(auth.sub, { status: "deleted" });
        await deps.da.refreshTokenFamilies.revokeAllForUser(auth.sub, "logout");
      },
    );

    deleteCookie(c, atCookie, { path: "/" });
    deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });

    const scheduledHardDeleteAt = new Date(
      Date.now() + REFRESH_TTL_SECONDS * 1000,
    ).toISOString();
    return c.json(
      {
        data: { scheduledHardDeleteAt, ticketId: randomUUID() },
        meta: { requestId: randomUUID() },
      },
      202,
    );
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

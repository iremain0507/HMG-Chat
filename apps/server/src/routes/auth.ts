// routes/auth.ts — 16-API-CONTRACT.md § 1 Auth 단일 출처.
// Magic-link 기반 가입/로그인 + P22-T1-13(계약배치 C4) 비밀번호 로그인(POST /login).
// 해시는 UserRepo.credentialsByEmail 로만 읽고 User DTO 에는 싣지 않는다.
import { Hono, type Context } from "hono";
import bcrypt from "bcryptjs";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type {
  DataAccess,
  EmailSender,
  Organization,
  User,
} from "@wchat/interfaces";
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
import {
  LdapConnectionError,
  mapGroupsToRole,
  resolveLdapConfig,
  type LdapDirectoryClient,
  type OrgRole,
} from "../lib/ldap-client.js";
import {
  createPkcePair,
  OidcConnectionError,
  readTrustedHeaderIdentity,
  resolveOidcConfig,
  resolveTrustedHeaderConfig,
  type OidcClient,
} from "../lib/oidc-client.js";

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
  // P22-T1-11(C14) — LDAP/AD 디렉터리 로그인. 미주입이면 POST /login/directory 는
  // 항상 403 DIRECTORY_AUTH_DISABLED (기존 배포 동작 무변경).
  directoryClient?: LdapDirectoryClient;
  // P22-T1-17(C16) — OAuth/OIDC SSO. 미주입이면 /login/oidc 는 항상 sso_disabled 로
  // 되돌린다(기존 배포 동작 무변경). trusted-header 경로는 이 클라이언트가 필요 없다.
  oidcClient?: OidcClient;
  // ldapBindPasswordRef·oidcClientSecretRef·trustedHeaderSecretRef 가 가리키는 비밀을
  // 읽을 환경. 미주입 시 process.env.
  env?: Record<string, string | undefined>;
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

    // P22-T1-16(C15) — SCIM deprovision(status='suspended') / 계정삭제(status='deleted')
    // 는 자격증명 검증을 통과해도 세션을 주지 않는다. 자격증명이 맞은 뒤라 계정 열거
    // 위험이 없으므로 401 로 뭉개지 않고 원인을 알 수 있는 403 으로 구분한다.
    if (user.status !== "active") {
      return c.json(
        errorJson(
          "ACCOUNT_INACTIVE",
          "비활성화된 계정입니다. 관리자에게 문의하세요.",
        ),
        403,
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

  // ── P22-T1-11(계약배치 C14) — POST /login/directory (LDAP/AD) ──────────────
  // 조직은 body.orgDomain > username 의 이메일 도메인 > 단일 allowedDomain 순으로 결정한다
  // (설정 조회가 bind 보다 먼저라 org 를 알아야 한다). 최종 권한은 디렉터리가 돌려준
  // 이메일 도메인으로 다시 검증하므로 body 로 org 를 갈아탈 수 없다.
  // 400 INVALID_INPUT / 401 INVALID_CREDENTIALS / 403 DIRECTORY_AUTH_DISABLED ·
  // DIRECTORY_GROUP_FORBIDDEN · EMAIL_DOMAIN_FORBIDDEN / 429 RATE_LIMITED / 503 DIRECTORY_UNAVAILABLE
  app.post("/login/directory", async (c) => {
    type DirectoryLoginBody = {
      username?: string;
      password?: string;
      orgDomain?: string;
    };
    const body = await c.req
      .json<DirectoryLoginBody>()
      .catch(() => ({}) as DirectoryLoginBody);
    const username = body.username?.trim();
    const password = body.password;
    if (!username || !password) {
      return c.json(
        errorJson("INVALID_INPUT", "사용자명/비밀번호를 확인하세요."),
        400,
      );
    }

    const disabled = () =>
      c.json(
        errorJson(
          "DIRECTORY_AUTH_DISABLED",
          "이 조직은 디렉터리(LDAP/AD) 로그인이 활성화되어 있지 않습니다.",
        ),
        403,
      );

    const hintDomain = (
      body.orgDomain ??
      (username.includes("@") ? emailDomain(username) : undefined) ??
      (deps.allowedDomains.length === 1 ? deps.allowedDomains[0] : undefined)
    )?.toLowerCase();
    if (!hintDomain) return disabled();

    const settingsOrg = await findOrgByDomain(hintDomain);
    if (!settingsOrg) return disabled();

    const resolved = await resolveAuthSettingsSafely(
      deps.settings,
      settingsOrg.id,
    );
    const config = resolveLdapConfig(resolved, deps.env ?? process.env);
    if (!deps.directoryClient || !config) return disabled();

    // 비밀번호 로그인과 동일한 brute-force 카운터를 공유한다(같은 계정 표면).
    const rateKey = `ldap:${hintDomain}:${username.toLowerCase()}`;
    if (rateLimited(rateKey)) {
      return c.json(
        errorJson(
          "RATE_LIMITED",
          "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.",
          true,
        ),
        429,
      );
    }

    let entry;
    try {
      entry = await deps.directoryClient.authenticate(
        config,
        username,
        password,
      );
    } catch (err) {
      // 인프라 실패는 자격증명 오류와 구분한다 — 재시도 가능(503).
      if (err instanceof LdapConnectionError) {
        return c.json(
          errorJson(
            "DIRECTORY_UNAVAILABLE",
            "디렉터리 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.",
            true,
          ),
          503,
        );
      }
      throw err;
    }

    if (!entry) {
      recordFailure(rateKey);
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "사용자명 또는 비밀번호가 올바르지 않습니다.",
        ),
        401,
      );
    }

    const email = entry.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      recordFailure(rateKey);
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "디렉터리 계정에 유효한 이메일이 없습니다.",
        ),
        401,
      );
    }

    // 디렉터리가 돌려준 이메일 도메인이 최종 권위 — 허용목록·org·그룹롤·프로비저닝은
    // OIDC/trusted-header 와 같은 규칙이라 provisionFederatedUser 로 공유한다.
    const result = await provisionFederatedUser({
      email,
      name: entry.name,
      groups: entry.groups,
      groupRoleMap: resolved.ldapGroupRoleMap,
      defaultRole: resolved.defaultUserRole ?? "member",
    });
    if (!result.ok) {
      if (result.reason === "domain_forbidden") {
        return c.json(
          errorJson(
            "EMAIL_DOMAIN_FORBIDDEN",
            `${deps.allowedDomains.join(", ")} 도메인만 로그인 가능합니다.`,
          ),
          403,
        );
      }
      if (result.reason === "group_forbidden") {
        return c.json(
          errorJson(
            "DIRECTORY_GROUP_FORBIDDEN",
            "이 서비스에 접근이 허용된 디렉터리 그룹에 속해 있지 않습니다.",
          ),
          403,
        );
      }
      return c.json(
        errorJson(
          "ACCOUNT_INACTIVE",
          "비활성화된 계정입니다. 관리자에게 문의하세요.",
        ),
        403,
      );
    }

    loginFailures.delete(rateKey);
    await issueSession(c, result.user.id, result.user.orgId, result.user.role);

    return c.json(sessionPayload(result.user, result.org));
  });

  // ── 외부 신원공급자(LDAP·OIDC·trusted-header) 공통 프로비저닝 ────────────────
  // 세 경로 모두 "IdP 가 준 이메일이 최종 권위" 라는 같은 규칙을 따른다:
  // 허용도메인 → org 판정 → 그룹→롤 매핑 → 유저 생성/동기화. 표면별로 다른 것은
  // 실패를 어떤 응답(JSON 에러 vs 302 redirect)으로 표현하느냐뿐이다.
  type FederatedResult =
    | { ok: true; user: User; org: Organization }
    | {
        ok: false;
        reason: "domain_forbidden" | "group_forbidden" | "account_inactive";
      };

  async function provisionFederatedUser(input: {
    email: string;
    name: string | null;
    groups: string[];
    groupRoleMap: Record<string, OrgRole>;
    defaultRole: OrgRole;
  }): Promise<FederatedResult> {
    const domain = emailDomain(input.email);
    if (!deps.allowedDomains.includes(domain)) {
      return { ok: false, reason: "domain_forbidden" };
    }
    const org = await findOrgByDomain(domain);
    if (!org) return { ok: false, reason: "domain_forbidden" };

    // undefined = 그룹 게이트 미설정(기본 롤), null = 매핑된 그룹 없음(거부).
    const mappedRole = mapGroupsToRole(input.groups, input.groupRoleMap);
    if (mappedRole === null) return { ok: false, reason: "group_forbidden" };
    const role = mappedRole ?? input.defaultRole;

    const existing = await deps.da.users.list({
      orgId: org.id,
      emailEq: input.email,
    });
    let user = existing.items[0] ?? null;
    // 프로비저닝 상태(status)의 권위 출처는 SCIM/관리자다 — IdP 인증 성공만으로
    // 비활성 계정이 되살아나면 안 된다(P22-T1-16 C15 와 동일 규칙).
    if (user && user.status !== "active") {
      return { ok: false, reason: "account_inactive" };
    }
    if (user) {
      // IdP 가 권위 있는 출처 — 롤/이름을 로그인 때마다 동기화한다.
      user = await deps.da.users.update(user.id, {
        role,
        name: input.name ?? user.name,
        lastLoginAt: new Date(),
      });
    } else {
      user = await deps.da.users.insert({
        orgId: org.id,
        email: input.email,
        name: input.name ?? input.email,
        role,
        customInstructions: null,
        language: null,
        status: "active",
        lastLoginAt: new Date(),
      });
    }
    return { ok: true, user, org };
  }

  function sessionPayload(user: User, org: Organization) {
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          orgId: user.orgId,
          role: user.role,
          customInstructions: user.customInstructions,
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
    };
  }

  // ── P22-T1-17(계약배치 C16) — OAuth/OIDC SSO ────────────────────────────────
  // 브라우저 리다이렉트 흐름이라 실패는 JSON 이 아니라 /login?error=<code> 302 로 표현한다
  // (magic-link/verify 와 동일 관례). state·nonce·PKCE verifier 는 httpOnly 쿠키에 담아
  // 콜백에서 대조한다 — 쿠키가 없거나 state 가 다르면 CSRF 로 보고 거부.
  const oidcCookie = `${cookiePrefix}_oidc`;
  const OIDC_COOKIE_PATH = "/api/v1/auth";
  const OIDC_STATE_TTL_SECONDS = 10 * 60;

  interface OidcFlowState {
    state: string;
    nonce: string;
    verifier: string;
    orgDomain: string;
  }

  /** 요청에서 org 를 판정한다(설정 조회가 IdP 왕복보다 먼저라 org 를 알아야 한다). */
  function hintOrgDomain(explicit?: string): string | undefined {
    return (
      explicit ??
      (deps.allowedDomains.length === 1 ? deps.allowedDomains[0] : undefined)
    )?.toLowerCase();
  }

  app.get("/login/oidc", async (c) => {
    const domain = hintOrgDomain(c.req.query("orgDomain"));
    if (!domain) return c.redirect(loginUrl("sso_disabled"), 302);
    const org = await findOrgByDomain(domain);
    if (!org) return c.redirect(loginUrl("sso_disabled"), 302);

    const resolved = await resolveAuthSettingsSafely(deps.settings, org.id);
    const config = resolveOidcConfig(resolved, deps.env ?? process.env);
    if (!deps.oidcClient || !config) {
      return c.redirect(loginUrl("sso_disabled"), 302);
    }

    const { verifier, challenge } = createPkcePair();
    const flow: OidcFlowState = {
      state: randomBytes(16).toString("base64url"),
      nonce: randomBytes(16).toString("base64url"),
      verifier,
      orgDomain: domain,
    };
    setCookie(
      c,
      oidcCookie,
      Buffer.from(JSON.stringify(flow)).toString("base64url"),
      {
        httpOnly: true,
        secure,
        sameSite: "Lax",
        path: OIDC_COOKIE_PATH,
        maxAge: OIDC_STATE_TTL_SECONDS,
      },
    );

    return c.redirect(
      deps.oidcClient.authorizationUrl(config, {
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge: challenge,
      }),
      302,
    );
  });

  app.get("/login/oidc/callback", async (c) => {
    function fail(error: string) {
      deleteCookie(c, oidcCookie, { path: OIDC_COOKIE_PATH });
      return c.redirect(loginUrl(error), 302);
    }

    let flow: OidcFlowState | null = null;
    const raw = getCookie(c, oidcCookie);
    if (raw) {
      try {
        flow = JSON.parse(
          Buffer.from(raw, "base64url").toString("utf8"),
        ) as OidcFlowState;
      } catch {
        flow = null;
      }
    }
    const state = c.req.query("state");
    if (!flow?.state || !state || flow.state !== state)
      return fail("sso_state");

    const code = c.req.query("code");
    if (!code) return fail("sso_failed");

    const org = await findOrgByDomain(flow.orgDomain);
    if (!org) return fail("sso_disabled");
    const resolved = await resolveAuthSettingsSafely(deps.settings, org.id);
    const config = resolveOidcConfig(resolved, deps.env ?? process.env);
    if (!deps.oidcClient || !config) return fail("sso_disabled");

    let identity;
    try {
      identity = await deps.oidcClient.exchangeCode(config, {
        code,
        codeVerifier: flow.verifier,
        nonce: flow.nonce,
      });
    } catch (err) {
      // 인프라/설정 실패는 자격증명 오류와 구분한다(재시도 가능).
      if (err instanceof OidcConnectionError) return fail("sso_unavailable");
      throw err;
    }
    if (!identity) return fail("sso_failed");

    const email = identity.email.trim().toLowerCase();
    if (!isValidEmail(email)) return fail("sso_failed");

    const result = await provisionFederatedUser({
      email,
      name: identity.name,
      groups: identity.groups,
      groupRoleMap: resolved.oidcGroupRoleMap,
      defaultRole: resolved.defaultUserRole ?? "member",
    });
    if (!result.ok) {
      return fail(
        result.reason === "group_forbidden" ? "sso_group" : result.reason,
      );
    }

    deleteCookie(c, oidcCookie, { path: OIDC_COOKIE_PATH });
    await issueSession(c, result.user.id, result.user.orgId, result.user.role);
    return c.redirect("/", 302);
  });

  // ── P22-T1-17(C16) — 역프록시 trusted-header 로그인 ──────────────────────────
  // oauth2-proxy·Cloudflare Access 처럼 앞단이 이미 인증을 끝낸 배포용. 헤더는 위조가 쉬워
  // 기본 비활성 + 프록시 공유비밀(설정 시) 두 겹으로 막는다(lib/oidc-client.ts 참조).
  // 403 TRUSTED_HEADER_DISABLED · EMAIL_DOMAIN_FORBIDDEN · TRUSTED_HEADER_GROUP_FORBIDDEN ·
  // ACCOUNT_INACTIVE / 401 INVALID_CREDENTIALS
  app.post("/login/trusted-header", async (c) => {
    const disabled = () =>
      c.json(
        errorJson(
          "TRUSTED_HEADER_DISABLED",
          "이 조직은 프록시 헤더 인증이 활성화되어 있지 않습니다.",
        ),
        403,
      );

    const domain = hintOrgDomain();
    if (!domain) return disabled();
    const settingsOrg = await findOrgByDomain(domain);
    if (!settingsOrg) return disabled();

    const resolved = await resolveAuthSettingsSafely(
      deps.settings,
      settingsOrg.id,
    );
    const config = resolveTrustedHeaderConfig(
      resolved,
      deps.env ?? process.env,
    );
    if (!config) return disabled();

    const identity = readTrustedHeaderIdentity(config, c.req.raw.headers);
    if (!identity) {
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "신뢰할 수 있는 프록시 신원 헤더가 없습니다.",
        ),
        401,
      );
    }

    const email = identity.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return c.json(
        errorJson(
          "INVALID_CREDENTIALS",
          "헤더의 이메일 형식이 올바르지 않습니다.",
        ),
        401,
      );
    }

    const result = await provisionFederatedUser({
      email,
      name: identity.name,
      groups: identity.groups,
      groupRoleMap: resolved.trustedHeaderGroupRoleMap,
      defaultRole: resolved.defaultUserRole ?? "member",
    });
    if (!result.ok) {
      if (result.reason === "domain_forbidden") {
        return c.json(
          errorJson(
            "EMAIL_DOMAIN_FORBIDDEN",
            `${deps.allowedDomains.join(", ")} 도메인만 로그인 가능합니다.`,
          ),
          403,
        );
      }
      if (result.reason === "group_forbidden") {
        return c.json(
          errorJson(
            "TRUSTED_HEADER_GROUP_FORBIDDEN",
            "이 서비스에 접근이 허용된 그룹에 속해 있지 않습니다.",
          ),
          403,
        );
      }
      return c.json(
        errorJson(
          "ACCOUNT_INACTIVE",
          "비활성화된 계정입니다. 관리자에게 문의하세요.",
        ),
        403,
      );
    }

    await issueSession(c, result.user.id, result.user.orgId, result.user.role);
    return c.json(sessionPayload(result.user, result.org));
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
    // P22-T1-16(C15) — 비활성 계정은 아직 만료되지 않은 access token 을 들고 와도
    // 세션 확인에 실패한다(프론트는 /me 401 을 로그아웃 신호로 다룬다).
    if (!user || user.status !== "active") {
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

    // P22-T1-16(C15) — 로그인 이후 비활성화된 계정은 세션을 연장할 수 없다.
    // family 까지 revoke 해서 남은 refresh token 세대를 전부 죽인다(DELETE /me 와 동일 취급).
    if (user.status !== "active") {
      await deps.da.refreshTokenFamilies.revoke(family.familyId, "logout");
      deleteCookie(c, atCookie, { path: "/" });
      deleteCookie(c, rtCookie, { path: "/api/v1/auth/refresh" });
      return c.json(
        errorJson("UNAUTHENTICATED", "비활성화된 계정입니다."),
        401,
        { "WWW-Authenticate": "re-login" },
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

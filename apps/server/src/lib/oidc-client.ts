// oidc-client.ts — P22-T1-17(계약배치 C16) OAuth 2.0 / OIDC SSO + trusted-header 인증.
//   설계: lib/ldap-client.ts(C14)와 같은 "인터페이스 + dev-stub 주입" 패턴.
//     - 테스트/로컬: createInMemoryOidcClient (실 IdP 불요)
//     - 배포: createHttpOidcClient (표준 authorization_code + PKCE. 신규 dep 없이 fetch 로 구현)
//   설정은 org_settings(JSONB)에 저장하고 **client_secret 은 DB 에 저장하지 않는다** —
//   ldapBindPasswordRef 와 동일하게 env 변수 이름(ref)만 저장하고 서버가 env 에서 읽는다.
//   packages/interfaces·shared 미사용(frozen 회피) — 이 phase 전용 LOCAL 타입.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ResolvedOrgSettings } from "./org-settings-schema.js";

export interface OidcAuthConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  /** 비어 있으면 id_token 클레임만 사용한다. */
  userinfoEndpoint: string;
  clientId: string;
  /** org_settings 가 아니라 env(oidcClientSecretRef)에서만 온다. */
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  emailClaim: string;
  nameClaim: string;
  groupsClaim: string;
}

export interface OidcIdentity {
  /** IdP 의 안정적 사용자 식별자(sub). */
  subject: string;
  email: string;
  name: string | null;
  groups: string[];
}

export interface OidcExchangeParams {
  code: string;
  codeVerifier: string;
  /** authorize 요청 때 보낸 nonce. id_token 의 nonce 와 대조한다. */
  nonce?: string;
}

export interface OidcClient {
  /** IdP authorize 엔드포인트 URL(302 대상). */
  authorizationUrl(
    config: OidcAuthConfig,
    params: { state: string; nonce: string; codeChallenge: string },
  ): string;
  /**
   * authorization code 교환. 성공 시 신원, 코드가 유효하지 않으면 null.
   * IdP 도달 불가·설정 오류는 OidcConnectionError 로 구분해 던진다(401 vs 503).
   */
  exchangeCode(
    config: OidcAuthConfig,
    params: OidcExchangeParams,
  ): Promise<OidcIdentity | null>;
}

/** 자격증명 오류(→로그인 실패)와 구분되는 인프라/설정 실패. */
export class OidcConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "OidcConnectionError";
  }
}

// ── PKCE (RFC 7636) ──────────────────────────────────────────────────────────
function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32)); // 43자 base64url
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizationUrl(
  config: OidcAuthConfig,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

// ── 클레임 → 신원 매핑 ────────────────────────────────────────────────────────
export type OidcClaims = Record<string, unknown>;

function claimString(claims: OidcClaims, key: string): string | null {
  const value = claims[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

/** groups 클레임은 IdP 마다 배열/공백구분 문자열/CSV 로 제각각이라 목록으로 정규화한다. */
function claimList(claims: OidcClaims, key: string): string[] {
  const value = claims[key];
  if (Array.isArray(value))
    return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string")
    return value
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

export function identityFromClaims(
  config: OidcAuthConfig,
  claims: OidcClaims,
): OidcIdentity | null {
  const email = claimString(claims, config.emailClaim);
  if (!email) return null; // 이메일 없는 신원은 User 로 매핑 불가
  return {
    subject: claimString(claims, "sub") ?? email,
    email,
    name: claimString(claims, config.nameClaim),
    groups: claimList(claims, config.groupsClaim),
  };
}

// ── org_settings → OidcAuthConfig ────────────────────────────────────────────
// env ref 는 OIDC_ 접두 + 대문자/숫자/_ 만 허용 — 임의 env(JWT_SECRET 등) 조회를 막는다
// (ldapBindPasswordRef·webSearchApiKeyRef 와 동일 원칙).
const CLIENT_SECRET_REF_PATTERN = /^OIDC_[A-Z0-9_]+$/;

export function resolveOidcConfig(
  settings: Pick<
    ResolvedOrgSettings,
    | "oidcEnabled"
    | "oidcIssuer"
    | "oidcAuthorizationEndpoint"
    | "oidcTokenEndpoint"
    | "oidcUserinfoEndpoint"
    | "oidcClientId"
    | "oidcClientSecretRef"
    | "oidcRedirectUri"
    | "oidcScopes"
    | "oidcEmailClaim"
    | "oidcNameClaim"
    | "oidcGroupsClaim"
  >,
  env: Record<string, string | undefined> = process.env,
): OidcAuthConfig | null {
  if (!settings.oidcEnabled) return null;
  const issuer = settings.oidcIssuer?.trim() ?? "";
  const authorizationEndpoint =
    settings.oidcAuthorizationEndpoint?.trim() ?? "";
  const tokenEndpoint = settings.oidcTokenEndpoint?.trim() ?? "";
  const clientId = settings.oidcClientId?.trim() ?? "";
  const redirectUri = settings.oidcRedirectUri?.trim() ?? "";
  if (
    !issuer ||
    !authorizationEndpoint ||
    !tokenEndpoint ||
    !clientId ||
    !redirectUri
  ) {
    return null;
  }

  const ref = settings.oidcClientSecretRef?.trim() ?? "";
  const clientSecret = CLIENT_SECRET_REF_PATTERN.test(ref)
    ? (env[ref] ?? "")
    : "";

  const scopes = (settings.oidcScopes ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    issuer,
    authorizationEndpoint,
    tokenEndpoint,
    userinfoEndpoint: settings.oidcUserinfoEndpoint?.trim() ?? "",
    clientId,
    clientSecret,
    redirectUri,
    scopes: scopes.includes("openid") ? scopes : ["openid", ...scopes],
    emailClaim: settings.oidcEmailClaim,
    nameClaim: settings.oidcNameClaim,
    groupsClaim: settings.oidcGroupsClaim,
  };
}

// ── in-memory dev-stub ───────────────────────────────────────────────────────
export interface InMemoryIdp {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  /** 발급 완료된 authorization code → id_token 클레임. */
  codes: Record<string, { claims: OidcClaims }>;
}

/**
 * 실 IdP 없이 동작을 검증하기 위한 in-memory 구현.
 * 토큰 엔드포인트 도달성·클라이언트 인증·코드 유효성을 실 클라이언트와 같은 계약으로 흉내낸다.
 */
export function createInMemoryOidcClient(idp: InMemoryIdp): OidcClient {
  return {
    authorizationUrl: buildAuthorizationUrl,

    async exchangeCode(config, params) {
      if (config.tokenEndpoint !== idp.tokenEndpoint) {
        throw new OidcConnectionError(
          `토큰 엔드포인트에 연결할 수 없습니다: ${config.tokenEndpoint}`,
        );
      }
      if (
        config.clientId !== idp.clientId ||
        config.clientSecret !== idp.clientSecret
      ) {
        // 클라이언트 인증 실패 = 사용자 자격증명이 아니라 서버 설정 오류다.
        throw new OidcConnectionError(
          "IdP 클라이언트 인증에 실패했습니다(client_id/secret 확인).",
        );
      }
      const issued = idp.codes[params.code];
      if (!issued) return null; // 만료/위조 code
      return identityFromClaims(config, issued.claims);
    },
  };
}

// ── 실 transport(fetch 기반 authorization_code + PKCE) ────────────────────────
// LOCAL_ONLY 환경에는 IdP 가 없어 이 경로의 실 IdP 왕복은 로컬에서 검증되지 않는다
// (주입된 fetch 로 프로토콜 수준만 테스트한다).
// id_token 은 TLS 위에서 토큰 엔드포인트로부터 직접 받고 client_secret 으로 클라이언트 인증을
// 하므로 OIDC Core §3.1.3.7 (6) 에 따라 서명 재검증 없이 클레임을 사용할 수 있다.
// (implicit/front-channel 로 받은 토큰이라면 서명 검증이 필수다 — 이 구현은 그 경로를 쓰지 않는다.)
type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

function decodeJwtClaims(idToken: string): OidcClaims | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as OidcClaims) : null;
  } catch {
    return null;
  }
}

export function createHttpOidcClient(options?: {
  fetchImpl?: FetchLike;
}): OidcClient {
  const doFetch = (options?.fetchImpl ?? fetch) as FetchLike;

  return {
    authorizationUrl: buildAuthorizationUrl,

    async exchangeCode(config, params) {
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: params.code,
        redirect_uri: config.redirectUri,
        client_id: config.clientId,
        code_verifier: params.codeVerifier,
      });
      if (config.clientSecret) body.set("client_secret", config.clientSecret);

      let res: Awaited<ReturnType<FetchLike>>;
      try {
        res = await doFetch(config.tokenEndpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json",
          },
          body: body.toString(),
        });
      } catch (cause) {
        throw new OidcConnectionError(
          "IdP 토큰 엔드포인트에 연결할 수 없습니다.",
          { cause },
        );
      }

      if (!res.ok) {
        // invalid_grant = 만료/재사용/위조 code → 자격증명 오류(로그인 실패).
        // 그 외(4xx 설정 오류·5xx)는 인프라/설정 실패로 구분한다.
        const detail = await res.text().catch(() => "");
        if (res.status === 400 && detail.includes("invalid_grant")) return null;
        throw new OidcConnectionError(
          `IdP 토큰 교환 실패(status=${res.status}).`,
        );
      }

      const payload = (await res.json().catch(() => null)) as {
        id_token?: string;
        access_token?: string;
      } | null;
      const idToken = payload?.id_token;
      if (!idToken) {
        throw new OidcConnectionError("IdP 응답에 id_token 이 없습니다.");
      }

      const claims = decodeJwtClaims(idToken);
      if (!claims) {
        throw new OidcConnectionError("id_token 을 해석할 수 없습니다.");
      }
      // OIDC Core §3.1.3.7 (2)(3) — 서명 재검증(6)은 생략해도 iss/aud 대조는 생략할 수 없다.
      // Azure AD common 처럼 다중 테넌트를 서비스하는 IdP 에서 다른 테넌트/다른 클라이언트용
      // 토큰이 통과하는 것을 막는다.
      if (claims.iss !== config.issuer) return null;
      const audience = claims.aud;
      const audienceOk = Array.isArray(audience)
        ? audience.includes(config.clientId)
        : audience === config.clientId;
      if (!audienceOk) return null;
      if (params.nonce && claims.nonce !== params.nonce) {
        return null; // 재생공격/세션 불일치
      }

      let identity = identityFromClaims(config, claims);
      // email/groups 를 id_token 에 싣지 않는 IdP 를 위해 userinfo 로 보강한다.
      if (
        (!identity || identity.groups.length === 0) &&
        config.userinfoEndpoint &&
        payload?.access_token
      ) {
        try {
          const ui = await doFetch(config.userinfoEndpoint, {
            headers: { authorization: `Bearer ${payload.access_token}` },
          });
          if (ui.ok) {
            const uiClaims = (await ui.json()) as OidcClaims;
            identity =
              identityFromClaims(config, { ...claims, ...uiClaims }) ??
              identity;
          }
        } catch {
          // userinfo 는 보강용 — 실패해도 id_token 클레임으로 진행한다.
        }
      }
      return identity;
    },
  };
}

// ── trusted-header (역프록시 인증) ────────────────────────────────────────────
// oauth2-proxy / Cloudflare Access 같은 프록시가 앞단에서 인증을 끝내고 신원을 헤더로 넘기는 배포용.
// 헤더는 위조가 쉬우므로 (a) 기본 비활성 (b) 프록시 공유비밀 헤더 일치 필수(설정 시) 두 겹으로 막는다.
export const PROXY_SECRET_HEADER = "x-wchat-proxy-secret";
const PROXY_SECRET_REF_PATTERN = /^TRUSTED_HEADER_[A-Z0-9_]+$/;

export interface TrustedHeaderConfig {
  emailHeader: string;
  nameHeader: string;
  groupsHeader: string;
  /** 빈 문자열이면 공유비밀 검사를 하지 않는다(신뢰 네트워크 전제 — 배포 시 설정 권장). */
  secret: string;
}

export interface TrustedHeaderIdentity {
  email: string;
  name: string | null;
  groups: string[];
}

export function resolveTrustedHeaderConfig(
  settings: Pick<
    ResolvedOrgSettings,
    | "trustedHeaderEnabled"
    | "trustedHeaderEmail"
    | "trustedHeaderName"
    | "trustedHeaderGroups"
    | "trustedHeaderSecretRef"
  >,
  env: Record<string, string | undefined> = process.env,
): TrustedHeaderConfig | null {
  if (!settings.trustedHeaderEnabled) return null;
  const ref = settings.trustedHeaderSecretRef?.trim() ?? "";
  return {
    emailHeader: settings.trustedHeaderEmail,
    nameHeader: settings.trustedHeaderName,
    groupsHeader: settings.trustedHeaderGroups,
    secret: PROXY_SECRET_REF_PATTERN.test(ref) ? (env[ref] ?? "") : "",
  };
}

/** 길이 노출/타이밍 차이로 비밀이 새지 않게 상수시간 비교한다. */
function secretMatches(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function readTrustedHeaderIdentity(
  config: TrustedHeaderConfig,
  headers: { get(name: string): string | null },
): TrustedHeaderIdentity | null {
  if (
    config.secret &&
    !secretMatches(config.secret, headers.get(PROXY_SECRET_HEADER))
  ) {
    return null; // 프록시를 우회한 직접 요청
  }
  const email = headers.get(config.emailHeader)?.trim();
  if (!email) return null;
  const groups = (headers.get(config.groupsHeader) ?? "")
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter(Boolean);
  return {
    email,
    name: headers.get(config.nameHeader)?.trim() || null,
    groups,
  };
}

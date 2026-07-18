// oidc-client.test.ts — P22-T1-17(계약배치 C16) OAuth/OIDC SSO + trusted-header.
// RED 우선: 이 시점에 lib/oidc-client.ts 는 존재하지 않는다(SSO 경로 자체가 미구현).
import { describe, it, expect } from "vitest";
import {
  createHttpOidcClient,
  createInMemoryOidcClient,
  createPkcePair,
  OidcConnectionError,
  readTrustedHeaderIdentity,
  resolveOidcConfig,
  resolveTrustedHeaderConfig,
  type OidcAuthConfig,
} from "../oidc-client.js";
import { DEFAULT_ORG_SETTINGS } from "../org-settings-schema.js";

const OIDC_SETTINGS = {
  ...DEFAULT_ORG_SETTINGS,
  oidcEnabled: true,
  oidcIssuer: "https://idp.example.com",
  oidcAuthorizationEndpoint: "https://idp.example.com/authorize",
  oidcTokenEndpoint: "https://idp.example.com/token",
  oidcClientId: "wchat",
  oidcClientSecretRef: "OIDC_CLIENT_SECRET",
  oidcRedirectUri: "https://chat.example.com/api/v1/auth/login/oidc/callback",
};

const ENV = { OIDC_CLIENT_SECRET: "idp-secret" };

function config(): OidcAuthConfig {
  const resolved = resolveOidcConfig(OIDC_SETTINGS, ENV);
  if (!resolved) throw new Error("config expected");
  return resolved;
}

function idpClient() {
  return createInMemoryOidcClient({
    tokenEndpoint: "https://idp.example.com/token",
    clientId: "wchat",
    clientSecret: "idp-secret",
    codes: {
      "code-kim": {
        claims: {
          sub: "kim-sub",
          email: "kim@wchat.example.com",
          name: "김위아",
          groups: ["wchat-admins", "all-staff"],
        },
      },
    },
  });
}

describe("lib/oidc-client — resolveOidcConfig", () => {
  it("oidcEnabled=false(기본값) → null (SSO 미설정 org 는 기존 경로 그대로)", () => {
    expect(resolveOidcConfig(DEFAULT_ORG_SETTINGS, ENV)).toBeNull();
  });

  it("clientSecret 은 DB 가 아니라 env ref 에서만 온다", () => {
    expect(config().clientSecret).toBe("idp-secret");
  });

  it("OIDC_ 접두가 아닌 ref 는 조회 거부 — 임의 env(JWT_SECRET 등) 유출 방지", () => {
    const resolved = resolveOidcConfig(
      { ...OIDC_SETTINGS, oidcClientSecretRef: "JWT_SECRET" },
      { ...ENV, JWT_SECRET: "top-secret" },
    );
    expect(resolved?.clientSecret).toBe("");
  });

  it("issuer/clientId/endpoint 가 비면 null", () => {
    expect(
      resolveOidcConfig({ ...OIDC_SETTINGS, oidcClientId: "  " }, ENV),
    ).toBeNull();
  });
});

describe("lib/oidc-client — authorizationUrl (PKCE)", () => {
  it("state·nonce·PKCE S256 challenge 를 담은 IdP authorize URL 을 만든다", () => {
    const url = new URL(
      idpClient().authorizationUrl(config(), {
        state: "st-1",
        nonce: "nc-1",
        codeChallenge: "ch-1",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://idp.example.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("wchat");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://chat.example.com/api/v1/auth/login/oidc/callback",
    );
    expect(url.searchParams.get("scope")).toContain("openid");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("nonce")).toBe("nc-1");
    expect(url.searchParams.get("code_challenge")).toBe("ch-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("createPkcePair 는 verifier 와 그 S256 challenge 를 함께 준다", () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, 패딩 없음
    expect(createPkcePair().verifier).not.toBe(verifier);
  });
});

describe("lib/oidc-client — exchangeCode", () => {
  it("유효한 code → 클레임에서 subject/email/name/groups 를 매핑한다", async () => {
    const identity = await idpClient().exchangeCode(config(), {
      code: "code-kim",
      codeVerifier: "v-1",
    });
    expect(identity).toEqual({
      subject: "kim-sub",
      email: "kim@wchat.example.com",
      name: "김위아",
      groups: ["wchat-admins", "all-staff"],
    });
  });

  it("알 수 없는 code → null (자격증명 오류, 인프라 오류와 구분)", async () => {
    expect(
      await idpClient().exchangeCode(config(), {
        code: "forged",
        codeVerifier: "v-1",
      }),
    ).toBeNull();
  });

  it("client_secret 불일치 → OidcConnectionError (설정 오류는 401 이 아니라 503)", async () => {
    const bad = resolveOidcConfig(OIDC_SETTINGS, {
      OIDC_CLIENT_SECRET: "wrong",
    });
    await expect(
      idpClient().exchangeCode(bad!, { code: "code-kim", codeVerifier: "v-1" }),
    ).rejects.toBeInstanceOf(OidcConnectionError);
  });

  it("토큰 엔드포인트 미도달 → OidcConnectionError", async () => {
    await expect(
      idpClient().exchangeCode(
        { ...config(), tokenEndpoint: "https://down.example.com/token" },
        { code: "code-kim", codeVerifier: "v-1" },
      ),
    ).rejects.toBeInstanceOf(OidcConnectionError);
  });

  it("이메일 클레임이 없으면 User 로 매핑 불가 → null", async () => {
    const client = createInMemoryOidcClient({
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "wchat",
      clientSecret: "idp-secret",
      codes: { "code-noemail": { claims: { sub: "s" } } },
    });
    expect(
      await client.exchangeCode(config(), {
        code: "code-noemail",
        codeVerifier: "v-1",
      }),
    ).toBeNull();
  });

  it("커스텀 클레임 이름(oidcEmailClaim/oidcGroupsClaim)을 따른다", async () => {
    const custom = resolveOidcConfig(
      {
        ...OIDC_SETTINGS,
        oidcEmailClaim: "upn",
        oidcNameClaim: "display_name",
        oidcGroupsClaim: "roles",
      },
      ENV,
    );
    const client = createInMemoryOidcClient({
      tokenEndpoint: "https://idp.example.com/token",
      clientId: "wchat",
      clientSecret: "idp-secret",
      codes: {
        "code-custom": {
          claims: {
            sub: "s",
            upn: "lee@wchat.example.com",
            display_name: "이위아",
            roles: "wchat-admins",
          },
        },
      },
    });
    expect(
      await client.exchangeCode(custom!, {
        code: "code-custom",
        codeVerifier: "v-1",
      }),
    ).toEqual({
      subject: "s",
      email: "lee@wchat.example.com",
      name: "이위아",
      groups: ["wchat-admins"], // 문자열 클레임도 목록으로 정규화
    });
  });
});

// 실 transport 는 id_token 을 토큰 엔드포인트에서 직접(TLS+클라이언트인증) 받으므로
// OIDC Core §3.1.3.7 (6) 에 따라 서명 재검증은 생략한다. 하지만 (2)(3) 의 iss/aud 대조는
// 생략할 수 없다 — Azure AD common 처럼 여러 테넌트를 서비스하는 IdP 에서 다른 테넌트/다른
// 클라이언트용으로 발급된 토큰이 그대로 통과하면 안 되기 때문이다.
describe("lib/oidc-client — createHttpOidcClient id_token 검증", () => {
  function jwt(claims: Record<string, unknown>): string {
    const part = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
  }

  /** 주어진 클레임의 id_token 을 돌려주는 가짜 토큰 엔드포인트. */
  function clientReturning(claims: Record<string, unknown>) {
    return createHttpOidcClient({
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { id_token: jwt(claims) };
        },
        async text() {
          return "";
        },
      }),
    });
  }

  const VALID = {
    iss: "https://idp.example.com",
    aud: "wchat",
    sub: "kim-sub",
    email: "kim@wchat.example.com",
    name: "김위아",
    groups: ["wchat-admins"],
  };

  it("iss/aud 가 맞는 id_token → 신원으로 매핑한다", async () => {
    expect(
      await clientReturning(VALID).exchangeCode(config(), {
        code: "c",
        codeVerifier: "v",
      }),
    ).toEqual({
      subject: "kim-sub",
      email: "kim@wchat.example.com",
      name: "김위아",
      groups: ["wchat-admins"],
    });
  });

  it("iss 가 설정된 issuer 와 다르면 거부 — 다른 IdP/테넌트가 발급한 토큰", async () => {
    expect(
      await clientReturning({
        ...VALID,
        iss: "https://evil-tenant.example.com",
      }).exchangeCode(config(), { code: "c", codeVerifier: "v" }),
    ).toBeNull();
  });

  it("aud 에 우리 client_id 가 없으면 거부 — 다른 클라이언트용 토큰 재사용", async () => {
    expect(
      await clientReturning({ ...VALID, aud: "some-other-app" }).exchangeCode(
        config(),
        { code: "c", codeVerifier: "v" },
      ),
    ).toBeNull();
  });

  it("aud 가 배열이면 우리 client_id 포함 여부로 판정한다(OIDC 다중 audience)", async () => {
    expect(
      await clientReturning({
        ...VALID,
        aud: ["some-other-app", "wchat"],
      }).exchangeCode(config(), { code: "c", codeVerifier: "v" }),
    ).not.toBeNull();
  });
});

describe("lib/oidc-client — trusted header", () => {
  const HEADER_SETTINGS = {
    ...DEFAULT_ORG_SETTINGS,
    trustedHeaderEnabled: true,
    trustedHeaderSecretRef: "TRUSTED_HEADER_SECRET",
  };
  const HEADER_ENV = { TRUSTED_HEADER_SECRET: "proxy-secret" };

  function headers(map: Record<string, string>) {
    return {
      get: (name: string) => map[name.toLowerCase()] ?? null,
    };
  }

  it("trustedHeaderEnabled=false(기본값) → null (헤더 위조 표면을 기본 차단)", () => {
    expect(
      resolveTrustedHeaderConfig(DEFAULT_ORG_SETTINGS, HEADER_ENV),
    ).toBeNull();
  });

  it("프록시 공유 비밀이 맞으면 이메일/이름/그룹 헤더를 읽는다", () => {
    const cfg = resolveTrustedHeaderConfig(HEADER_SETTINGS, HEADER_ENV)!;
    expect(
      readTrustedHeaderIdentity(
        cfg,
        headers({
          "x-forwarded-email": "kim@wchat.example.com",
          "x-forwarded-user": "김위아",
          "x-forwarded-groups": "wchat-admins,all-staff",
          "x-wchat-proxy-secret": "proxy-secret",
        }),
      ),
    ).toEqual({
      email: "kim@wchat.example.com",
      name: "김위아",
      groups: ["wchat-admins", "all-staff"],
    });
  });

  it("공유 비밀이 설정됐는데 헤더가 틀리면 null — 프록시를 우회한 직접 요청 차단", () => {
    const cfg = resolveTrustedHeaderConfig(HEADER_SETTINGS, HEADER_ENV)!;
    expect(
      readTrustedHeaderIdentity(
        cfg,
        headers({
          "x-forwarded-email": "attacker@wchat.example.com",
          "x-wchat-proxy-secret": "guessed",
        }),
      ),
    ).toBeNull();
    expect(
      readTrustedHeaderIdentity(
        cfg,
        headers({ "x-forwarded-email": "attacker@wchat.example.com" }),
      ),
    ).toBeNull();
  });

  it("이메일 헤더가 없으면 null", () => {
    const cfg = resolveTrustedHeaderConfig(HEADER_SETTINGS, HEADER_ENV)!;
    expect(
      readTrustedHeaderIdentity(
        cfg,
        headers({ "x-wchat-proxy-secret": "proxy-secret" }),
      ),
    ).toBeNull();
  });

  it("헤더 이름은 org 설정으로 바꿀 수 있다", () => {
    const cfg = resolveTrustedHeaderConfig(
      { ...HEADER_SETTINGS, trustedHeaderEmail: "X-Auth-Request-Email" },
      HEADER_ENV,
    )!;
    expect(
      readTrustedHeaderIdentity(
        cfg,
        headers({
          "x-auth-request-email": "kim@wchat.example.com",
          "x-wchat-proxy-secret": "proxy-secret",
        }),
      )?.email,
    ).toBe("kim@wchat.example.com");
  });
});

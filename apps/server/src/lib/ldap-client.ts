// ldap-client.ts — P22-T1-11(계약배치 C14) LDAP/Active Directory 디렉터리 인증.
//   설계: 외부 서비스는 LOCAL_ONLY 라 "인터페이스 + dev-stub 주입" 패턴을 따른다
//   (knowledge/embedding-provider-dev-stub.ts, lib/object-store.ts, lib/kek-provider.ts 와 동일).
//     - 테스트/로컬: createInMemoryLdapDirectoryClient (실 디렉터리 서버 불요)
//     - 배포: createLdaptsDirectoryClient (승인 dep `ldapts`. 설치 전에는 명확한 에러로 실패)
//   설정은 org_settings(JSONB) 에 저장하고 **bind 비밀번호는 DB 에 저장하지 않는다** —
//   webSearchApiKeyRef 와 동일하게 env 변수 이름(ref)만 저장하고 서버가 env 에서 읽는다.
//   packages/interfaces·shared 미사용(frozen 회피) — 이 phase 전용 LOCAL 타입.

import type { ResolvedOrgSettings } from "./org-settings-schema.js";

export type OrgRole = "member" | "admin" | "owner";

export interface LdapAuthConfig {
  /** ldap:// 또는 ldaps:// URL (예: ldaps://dc.corp.example.com:636) */
  url: string;
  /** 검색용 서비스 계정 DN. 빈 문자열이면 익명 bind 후 검색. */
  bindDn: string;
  /** 서비스 계정 비밀번호. org_settings 가 아니라 env(ldapBindPasswordRef)에서만 온다. */
  bindPassword: string;
  /** 사용자 검색 base DN. 이 서브트리 밖의 엔트리는 로그인 불가. */
  baseDn: string;
  /** {{username}} 자리표시자를 가진 RFC 4515 필터. */
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
  groupAttribute: string;
  /** ldaps 자체서명 인증서 허용 여부. 기본 true(=검증). */
  tlsRejectUnauthorized?: boolean;
}

export interface LdapDirectoryEntry {
  dn: string;
  email: string;
  name: string | null;
  /** groupAttribute(기본 memberOf)의 그룹 DN 목록. */
  groups: string[];
}

export interface LdapDirectoryClient {
  /** 서비스 계정 bind 만 수행(admin 설정 화면의 "연결 테스트"). 실패 시 throw. */
  testConnection(config: LdapAuthConfig): Promise<void>;
  /**
   * 사용자 검색 후 해당 DN 으로 bind. 성공 시 엔트리, 자격증명 불일치/미검색 시 null.
   * 서버 도달 불가·프로토콜 오류는 LdapConnectionError 로 구분해 던진다(401 vs 503).
   */
  authenticate(
    config: LdapAuthConfig,
    username: string,
    password: string,
  ): Promise<LdapDirectoryEntry | null>;
}

/** 자격증명 불일치(→401)와 구분되는 인프라 실패(→503). */
export class LdapConnectionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LdapConnectionError";
  }
}

// ── 필터 이스케이프(RFC 4515) — 사용자 입력이 검색 필터를 바꾸지 못하게 한다 ──
const FILTER_ESCAPES: Record<string, string> = {
  "\\": "\\5c",
  "*": "\\2a",
  "(": "\\28",
  ")": "\\29",
  "\0": "\\00",
  "/": "\\2f",
};

export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\\*()\0/]/g, (ch) => FILTER_ESCAPES[ch] ?? ch);
}

export function buildUserFilter(template: string, username: string): string {
  return template.replace(/\{\{\s*username\s*\}\}/g, () =>
    escapeLdapFilterValue(username),
  );
}

// ── 그룹 → 롤 매핑 ────────────────────────────────────────────────────────────
const ROLE_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * 그룹 DN 목록을 org 롤로 환산한다.
 *  - roleMap 이 비어 있으면 `undefined` = 그룹 게이트 미설정(모든 디렉터리 사용자 허용).
 *  - 매핑은 있으나 어느 그룹에도 속하지 않으면 `null` = 로그인 거부.
 *  - 여러 그룹에 속하면 가장 높은 권한을 채택한다.
 * DN 은 대소문자를 구분하지 않는 것이 AD 관례라 비교 전에 소문자화한다.
 */
export function mapGroupsToRole(
  groups: string[],
  roleMap: Record<string, OrgRole>,
): OrgRole | null | undefined {
  const entries = Object.entries(roleMap);
  if (entries.length === 0) return undefined;
  const normalized = new Set(groups.map((g) => g.trim().toLowerCase()));
  let best: OrgRole | null = null;
  for (const [dn, role] of entries) {
    if (!normalized.has(dn.trim().toLowerCase())) continue;
    if (!best || ROLE_RANK[role] > ROLE_RANK[best]) best = role;
  }
  return best;
}

// ── org_settings → LdapAuthConfig ────────────────────────────────────────────
// env ref 는 LDAP_ 접두 + 대문자/숫자/_ 만 허용 — 임의 env(JWT_SECRET 등) 조회를 막는다
// (webSearchApiKeyRef 의 "서버가 아는 고정 ref 만" 원칙과 동일).
const BIND_PASSWORD_REF_PATTERN = /^LDAP_[A-Z0-9_]+$/;

export function resolveLdapConfig(
  settings: Pick<
    ResolvedOrgSettings,
    | "ldapEnabled"
    | "ldapUrl"
    | "ldapBindDn"
    | "ldapBindPasswordRef"
    | "ldapBaseDn"
    | "ldapUserFilter"
    | "ldapEmailAttribute"
    | "ldapNameAttribute"
    | "ldapGroupAttribute"
    | "ldapTlsRejectUnauthorized"
  >,
  env: Record<string, string | undefined> = process.env,
): LdapAuthConfig | null {
  if (!settings.ldapEnabled) return null;
  const url = settings.ldapUrl?.trim() ?? "";
  const baseDn = settings.ldapBaseDn?.trim() ?? "";
  if (!url || !baseDn) return null;

  const ref = settings.ldapBindPasswordRef?.trim() ?? "";
  const bindPassword = BIND_PASSWORD_REF_PATTERN.test(ref)
    ? (env[ref] ?? "")
    : "";

  return {
    url,
    bindDn: settings.ldapBindDn?.trim() ?? "",
    bindPassword,
    baseDn,
    userFilter: settings.ldapUserFilter,
    emailAttribute: settings.ldapEmailAttribute,
    nameAttribute: settings.ldapNameAttribute,
    groupAttribute: settings.ldapGroupAttribute,
    tlsRejectUnauthorized: settings.ldapTlsRejectUnauthorized,
  };
}

// ── in-memory dev-stub ───────────────────────────────────────────────────────
export interface InMemoryLdapEntry {
  dn: string;
  /** userFilter 가 매칭할 로그인 식별자들(sAMAccountName·mail 등). */
  usernames: string[];
  password: string;
  attributes: Record<string, string | string[]>;
}

export interface InMemoryLdapDirectory {
  url: string;
  bindDn?: string;
  bindPassword?: string;
  entries: InMemoryLdapEntry[];
}

function attr(
  attributes: Record<string, string | string[]>,
  key: string,
): string[] {
  const value = attributes[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function endsWithDn(dn: string, baseDn: string): boolean {
  return dn.trim().toLowerCase().endsWith(baseDn.trim().toLowerCase());
}

/**
 * 실 디렉터리 서버 없이 동작을 검증하기 위한 in-memory 구현.
 * baseDn 서브트리 검색·자격증명 대조·연결 실패를 실제 클라이언트와 같은 계약으로 흉내낸다.
 */
export function createInMemoryLdapDirectoryClient(
  directory: InMemoryLdapDirectory,
): LdapDirectoryClient {
  function assertReachable(config: LdapAuthConfig): void {
    if (config.url !== directory.url) {
      throw new LdapConnectionError(
        `LDAP 서버에 연결할 수 없습니다: ${config.url}`,
      );
    }
  }

  function assertServiceBind(config: LdapAuthConfig): void {
    if (!directory.bindDn) return; // 익명 bind 허용 디렉터리
    if (
      config.bindDn !== directory.bindDn ||
      config.bindPassword !== (directory.bindPassword ?? "")
    ) {
      throw new LdapConnectionError("서비스 계정 bind 에 실패했습니다.");
    }
  }

  return {
    async testConnection(config) {
      assertReachable(config);
      assertServiceBind(config);
    },

    async authenticate(config, username, password) {
      assertReachable(config);
      assertServiceBind(config);

      const needle = username.trim().toLowerCase();
      const found = directory.entries.find(
        (e) =>
          endsWithDn(e.dn, config.baseDn) &&
          e.usernames.some((u) => u.trim().toLowerCase() === needle),
      );
      if (!found) return null; // 검색범위 밖 또는 미존재
      if (!password || found.password !== password) return null; // bind 실패

      const email = attr(found.attributes, config.emailAttribute)[0];
      if (!email) return null; // 이메일 없는 엔트리는 User 로 매핑 불가
      return {
        dn: found.dn,
        email,
        name: attr(found.attributes, config.nameAttribute)[0] ?? null,
        groups: attr(found.attributes, config.groupAttribute),
      };
    },
  };
}

// ── 실 transport(ldapts) ─────────────────────────────────────────────────────
// LOCAL_ONLY 환경에는 디렉터리 서버가 없어 이 경로는 로컬에서 검증되지 않는다.
// 배포 시 `pnpm add ldapts`(CONTRACT_APPROVED DEPS_APPROVED) 후 활성화한다.
interface LdaptsClientLike {
  bind(dn: string, password: string): Promise<void>;
  unbind(): Promise<void>;
  search(
    baseDn: string,
    options: { scope: string; filter: string; attributes?: string[] },
  ): Promise<{ searchEntries: Array<Record<string, unknown>> }>;
}

async function loadLdapts(): Promise<{
  new (options: {
    url: string;
    tlsOptions?: { rejectUnauthorized?: boolean };
  }): LdaptsClientLike;
}> {
  const moduleName = "ldapts";
  try {
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      Client: new (options: {
        url: string;
        tlsOptions?: { rejectUnauthorized?: boolean };
      }) => LdaptsClientLike;
    };
    return mod.Client;
  } catch (cause) {
    throw new LdapConnectionError(
      "ldapts 모듈을 불러올 수 없습니다. 배포 환경에서 `pnpm add ldapts` 로 설치하세요.",
      { cause },
    );
  }
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  return null;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.map((v) => firstString(v)).filter((v): v is string => !!v);
  return [];
}

export function createLdaptsDirectoryClient(): LdapDirectoryClient {
  async function withClient<T>(
    config: LdapAuthConfig,
    fn: (client: LdaptsClientLike) => Promise<T>,
  ): Promise<T> {
    const Client = await loadLdapts();
    const client = new Client({
      url: config.url,
      tlsOptions: {
        rejectUnauthorized: config.tlsRejectUnauthorized !== false,
      },
    });
    try {
      return await fn(client);
    } finally {
      await client.unbind().catch(() => {});
    }
  }

  return {
    async testConnection(config) {
      await withClient(config, async (client) => {
        try {
          await client.bind(config.bindDn, config.bindPassword);
        } catch (cause) {
          throw new LdapConnectionError("서비스 계정 bind 에 실패했습니다.", {
            cause,
          });
        }
      });
    },

    async authenticate(config, username, password) {
      return withClient(config, async (client) => {
        try {
          await client.bind(config.bindDn, config.bindPassword);
        } catch (cause) {
          throw new LdapConnectionError("서비스 계정 bind 에 실패했습니다.", {
            cause,
          });
        }

        let entries: Array<Record<string, unknown>>;
        try {
          const result = await client.search(config.baseDn, {
            scope: "sub",
            filter: buildUserFilter(config.userFilter, username),
            attributes: [
              config.emailAttribute,
              config.nameAttribute,
              config.groupAttribute,
            ],
          });
          entries = result.searchEntries;
        } catch (cause) {
          throw new LdapConnectionError("디렉터리 검색에 실패했습니다.", {
            cause,
          });
        }

        const entry = entries[0];
        const dn = entry ? firstString(entry.dn) : null;
        if (!entry || !dn) return null;

        // 사용자 DN 으로 재-bind = 실제 비밀번호 검증. 실패는 자격증명 오류(401)로 취급.
        try {
          await client.bind(dn, password);
        } catch {
          return null;
        }

        const email = firstString(entry[config.emailAttribute]);
        if (!email) return null;
        return {
          dn,
          email,
          name: firstString(entry[config.nameAttribute]),
          groups: stringList(entry[config.groupAttribute]),
        };
      });
    },
  };
}

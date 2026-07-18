// P22-T1-11(계약배치 C14) — LDAP/AD 디렉터리 인증 클라이언트 단위 테스트.
//   외부 디렉터리 서버는 LOCAL_ONLY 라 in-memory dev-stub 을 주입해 검증한다
//   (embedding-provider-dev-stub / object-store 와 동일 패턴). 실 ldapts transport 는 배포 시 교체.
import { describe, it, expect } from "vitest";
import {
  escapeLdapFilterValue,
  buildUserFilter,
  mapGroupsToRole,
  resolveLdapConfig,
  createInMemoryLdapDirectoryClient,
  LdapConnectionError,
  type LdapAuthConfig,
} from "../ldap-client.js";
import { DEFAULT_ORG_SETTINGS } from "../org-settings-schema.js";

const BASE_DN = "ou=People,dc=corp,dc=example,dc=com";

const CONFIG: LdapAuthConfig = {
  url: "ldaps://dc.corp.example.com:636",
  bindDn: "cn=svc-wchat,dc=corp,dc=example,dc=com",
  bindPassword: "svc-secret",
  baseDn: BASE_DN,
  userFilter: "(|(sAMAccountName={{username}})(mail={{username}}))",
  emailAttribute: "mail",
  nameAttribute: "displayName",
  groupAttribute: "memberOf",
};

function makeClient() {
  return createInMemoryLdapDirectoryClient({
    url: CONFIG.url,
    bindDn: CONFIG.bindDn,
    bindPassword: CONFIG.bindPassword,
    entries: [
      {
        dn: `cn=Kim,${BASE_DN}`,
        usernames: ["kim", "kim@wchat.example.com"],
        password: "directory-pw",
        attributes: {
          mail: "kim@wchat.example.com",
          displayName: "김위아",
          memberOf: [
            "cn=wchat-admins,ou=Groups,dc=corp,dc=example,dc=com",
            "cn=all-staff,ou=Groups,dc=corp,dc=example,dc=com",
          ],
        },
      },
      {
        // baseDn 밖(다른 OU) — 검색 범위에서 제외돼야 한다.
        dn: "cn=Contractor,ou=External,dc=corp,dc=example,dc=com",
        usernames: ["contractor"],
        password: "directory-pw",
        attributes: { mail: "contractor@wchat.example.com" },
      },
    ],
  });
}

describe("lib/ldap-client — filter escaping (RFC 4515)", () => {
  it("특수문자를 이스케이프해 LDAP 필터 인젝션을 차단한다", () => {
    expect(escapeLdapFilterValue("a)(uid=*")).toBe("a\\29\\28uid=\\2a");
    expect(escapeLdapFilterValue("back\\slash")).toBe("back\\5cslash");
    expect(escapeLdapFilterValue("nul\0")).toBe("nul\\00");
    expect(escapeLdapFilterValue("plain")).toBe("plain");
  });

  it("buildUserFilter 는 {{username}} 자리에 이스케이프된 값만 채운다", () => {
    expect(buildUserFilter("(uid={{username}})", "kim)(objectClass=*")).toBe(
      "(uid=kim\\29\\28objectClass=\\2a)",
    );
  });
});

describe("lib/ldap-client — mapGroupsToRole", () => {
  const roleMap = {
    "cn=wchat-owners,ou=Groups,dc=corp,dc=example,dc=com": "owner" as const,
    "cn=wchat-admins,ou=Groups,dc=corp,dc=example,dc=com": "admin" as const,
    "cn=all-staff,ou=Groups,dc=corp,dc=example,dc=com": "member" as const,
  };

  it("매핑된 그룹의 롤을 돌려주고 DN 대소문자는 무시한다", () => {
    expect(
      mapGroupsToRole(
        ["CN=ALL-STAFF,OU=Groups,DC=corp,DC=example,DC=com"],
        roleMap,
      ),
    ).toBe("member");
  });

  it("여러 그룹에 속하면 가장 높은 권한을 채택한다(owner > admin > member)", () => {
    expect(
      mapGroupsToRole(
        [
          "cn=all-staff,ou=Groups,dc=corp,dc=example,dc=com",
          "cn=wchat-admins,ou=Groups,dc=corp,dc=example,dc=com",
        ],
        roleMap,
      ),
    ).toBe("admin");
  });

  it("매핑에 없는 그룹만 가진 사용자는 null(=로그인 거부 대상)", () => {
    expect(
      mapGroupsToRole(
        ["cn=guests,ou=Groups,dc=corp,dc=example,dc=com"],
        roleMap,
      ),
    ).toBeNull();
  });

  it("roleMap 이 비어 있으면 그룹 게이트를 적용하지 않는다(undefined = 게이트 없음)", () => {
    expect(mapGroupsToRole(["cn=whatever"], {})).toBeUndefined();
  });
});

describe("lib/ldap-client — resolveLdapConfig(org settings → config)", () => {
  const env = { LDAP_BIND_PASSWORD: "svc-secret" };

  it("ldapEnabled=false(기본값) 면 null — 기존 동작 보존(비파괴)", () => {
    expect(DEFAULT_ORG_SETTINGS.ldapEnabled).toBe(false);
    expect(resolveLdapConfig(DEFAULT_ORG_SETTINGS, env)).toBeNull();
  });

  it("필수 항목(url/baseDn)이 비면 활성이어도 null", () => {
    expect(
      resolveLdapConfig(
        {
          ...DEFAULT_ORG_SETTINGS,
          ldapEnabled: true,
          ldapUrl: "",
          ldapBaseDn: "",
        },
        env,
      ),
    ).toBeNull();
  });

  it("ldapBindPasswordRef 가 가리키는 env 값을 읽어 config 를 만든다(비밀은 DB 미저장)", () => {
    const config = resolveLdapConfig(
      {
        ...DEFAULT_ORG_SETTINGS,
        ldapEnabled: true,
        ldapUrl: CONFIG.url,
        ldapBaseDn: BASE_DN,
        ldapBindDn: CONFIG.bindDn,
        ldapBindPasswordRef: "LDAP_BIND_PASSWORD",
      },
      env,
    );
    expect(config?.bindPassword).toBe("svc-secret");
    expect(config?.baseDn).toBe(BASE_DN);
    // 기본 속성 매핑(AD 관례)
    expect(config?.emailAttribute).toBe("mail");
    expect(config?.groupAttribute).toBe("memberOf");
  });

  it("LDAP_ 접두 밖의 임의 env 이름은 거부한다(임의 env 유출 방지)", () => {
    const config = resolveLdapConfig(
      {
        ...DEFAULT_ORG_SETTINGS,
        ldapEnabled: true,
        ldapUrl: CONFIG.url,
        ldapBaseDn: BASE_DN,
        ldapBindDn: CONFIG.bindDn,
        ldapBindPasswordRef: "JWT_SECRET",
      },
      { ...env, JWT_SECRET: "top-secret" },
    );
    expect(config?.bindPassword).toBe("");
  });
});

describe("lib/ldap-client — in-memory 디렉터리 클라이언트", () => {
  it("올바른 자격증명 → dn/email/name/groups 를 매핑해 반환", async () => {
    const entry = await makeClient().authenticate(
      CONFIG,
      "kim@wchat.example.com",
      "directory-pw",
    );
    expect(entry).not.toBeNull();
    expect(entry?.dn).toBe(`cn=Kim,${BASE_DN}`);
    expect(entry?.email).toBe("kim@wchat.example.com");
    expect(entry?.name).toBe("김위아");
    expect(entry?.groups).toContain(
      "cn=wchat-admins,ou=Groups,dc=corp,dc=example,dc=com",
    );
  });

  it("비밀번호가 틀리면 null(bind 실패)", async () => {
    expect(
      await makeClient().authenticate(CONFIG, "kim", "wrong-pw"),
    ).toBeNull();
  });

  it("baseDn 밖의 사용자는 검색되지 않아 null", async () => {
    expect(
      await makeClient().authenticate(CONFIG, "contractor", "directory-pw"),
    ).toBeNull();
  });

  it("서버에 도달할 수 없으면 LdapConnectionError", async () => {
    await expect(
      makeClient().authenticate(
        { ...CONFIG, url: "ldaps://unreachable.example.com" },
        "kim",
        "directory-pw",
      ),
    ).rejects.toBeInstanceOf(LdapConnectionError);
  });

  it("testConnection: 서비스 계정 bind 성공/실패를 구분한다", async () => {
    await expect(makeClient().testConnection(CONFIG)).resolves.toBeUndefined();
    await expect(
      makeClient().testConnection({ ...CONFIG, bindPassword: "nope" }),
    ).rejects.toBeInstanceOf(LdapConnectionError);
  });
});

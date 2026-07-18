// P22-T1-11(계약배치 C14) — admin 설정 화면의 "LDAP 연결 테스트" 서버측.
//   POST /api/v1/admin/settings/ldap/test — 저장된 org_settings 로 서비스 계정 bind 만 시도한다.
//   admin/owner 전용이고 orgId 는 JWT 에서만 파생 → cross-org 조회 불가.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createAdminSettingsRoutes } from "../admin-settings.js";
import type { OrgSettingsDataAccess } from "../../db/org-settings-data-access.js";
import type { SettingsService } from "../../lib/settings-service.js";
import {
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../../lib/org-settings-schema.js";
import { createInMemoryLdapDirectoryClient } from "../../lib/ldap-client.js";

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const OTHER_ORG_ID = "00000000-0000-0000-0000-0000000000bb";
const LDAP_URL = "ldaps://dc.corp.example.com:636";
const BIND_DN = "cn=svc-wchat,dc=corp,dc=example,dc=com";

const LDAP_ON: Partial<ResolvedOrgSettings> = {
  ldapEnabled: true,
  ldapUrl: LDAP_URL,
  ldapBindDn: BIND_DN,
  ldapBindPasswordRef: "LDAP_BIND_PASSWORD",
  ldapBaseDn: "ou=People,dc=corp,dc=example,dc=com",
};

function directoryClient() {
  return createInMemoryLdapDirectoryClient({
    url: LDAP_URL,
    bindDn: BIND_DN,
    bindPassword: "svc-secret",
    entries: [],
  });
}

function makeApp(
  settings: Partial<ResolvedOrgSettings>,
  role: "admin" | "member" = "admin",
  env: Record<string, string | undefined> = {
    LDAP_BIND_PASSWORD: "svc-secret",
  },
) {
  const settingsService = {
    async resolve() {
      return { ...DEFAULT_ORG_SETTINGS, ...settings };
    },
    invalidate() {},
  } as unknown as SettingsService;
  const da = {
    async upsert() {},
    async byOrgId() {
      return null;
    },
  } as unknown as OrgSettingsDataAccess;

  const routes = createAdminSettingsRoutes({
    da,
    settingsService,
    directoryClient: directoryClient(),
    env,
  });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: "user-1",
      org: ORG_ID,
      role,
    } as AuthedVariables["auth"]);
    await next();
  });
  app.route("/", routes);
  return app;
}

function testConnection(app: Hono<{ Variables: AuthedVariables }>) {
  return app.request("/ldap/test", { method: "POST" });
}

describe("routes/admin-settings — POST /ldap/test", () => {
  beforeEach(() => {
    // env 는 주입으로만 읽는다(프로세스 env 오염 방지).
  });

  it("member 롤 → 403 FORBIDDEN", async () => {
    const res = await testConnection(makeApp(LDAP_ON, "member"));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("LDAP 미설정(기본값) → 400 INVALID_INPUT", async () => {
    const res = await testConnection(makeApp({ ldapEnabled: false }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_INPUT");
  });

  it("서비스 계정 bind 성공 → 200 ok:true", async () => {
    const res = await testConnection(makeApp(LDAP_ON));
    expect(res.status).toBe(200);
    expect((await res.json()).data.ok).toBe(true);
  });

  it("bind 비밀번호가 틀리면 → 502 DIRECTORY_UNAVAILABLE(비밀 미노출)", async () => {
    const res = await testConnection(
      makeApp(LDAP_ON, "admin", { LDAP_BIND_PASSWORD: "wrong" }),
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("DIRECTORY_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("wrong");
  });

  it("도달 불가 URL → 502 DIRECTORY_UNAVAILABLE", async () => {
    const res = await testConnection(
      makeApp({ ...LDAP_ON, ldapUrl: "ldaps://unreachable.example.com" }),
    );
    expect(res.status).toBe(502);
  });

  it("orgId 는 JWT 에서만 파생된다 — body 로 다른 org 를 지정해도 무시", async () => {
    const app = makeApp(LDAP_ON);
    const res = await app.request("/ldap/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: OTHER_ORG_ID }),
    });
    expect(res.status).toBe(200);
  });
});

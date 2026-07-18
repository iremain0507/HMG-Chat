import { test, expect } from "@playwright/test";

// e2e/identity-ldap.pw.ts — P22-T6-22 브라우저 검증(Layer 1).
//   /preview 의 admin-settings-screen 섹션에서 Identity/LDAP 탭을 실제 chromium 으로 열어
//   저장된 설정 렌더 → 필드 편집 → 연결 테스트(POST /api/v1/admin/ldap/test) → 저장
//   (PUT /api/v1/admin/settings) 왕복이 실 DOM/네트워크로 동작하는지 확인한다.
//   서버(routes/admin-settings.ts, P22-T1-11)는 실 서버 없이 재현 가능하도록 page.route() 로
//   목킹하며, 실 계약을 그대로 흉내낸다: 성공은 {data:{ok:true}}, 디렉터리 장애는
//   502 + error.code=DIRECTORY_UNAVAILABLE.

const SETTINGS = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,
  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0,
  webSearchEnabled: false,
  webSearchResultCount: 3,
  enableDirectConnections: false,
  instanceName: "WChat",
  banner: [],
  responseWatermark: "",
  defaultUserRole: "member",
  enableSignup: false,
  maxUploadSizeMb: 25,
  maxUploadCount: 10,
  // P22-T1-11 org_settings ldap* — 서버 resolve 가 기본값을 채워 내려주는 형태 그대로.
  ldapEnabled: true,
  ldapUrl: "ldaps://dc.example.com:636",
  ldapBindDn: "CN=svc,OU=Service,DC=example,DC=com",
  ldapBindPasswordRef: "LDAP_BIND_PASSWORD",
  ldapBaseDn: "OU=Users,DC=example,DC=com",
  ldapUserFilter: "(|(sAMAccountName={{username}})(mail={{username}}))",
  ldapEmailAttribute: "mail",
  ldapNameAttribute: "displayName",
  ldapGroupAttribute: "memberOf",
  ldapGroupRoleMap: { "CN=Admins,DC=example,DC=com": "admin" },
  ldapTlsRejectUnauthorized: true,
};

async function mockBackend(
  page: import("@playwright/test").Page,
  opts: { ldapTestFails?: boolean; onPut?: (body: unknown) => void } = {},
) {
  await page.route("**/api/v1/admin/ldap/test", (route) => {
    if (opts.ldapTestFails) {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "DIRECTORY_UNAVAILABLE",
            category: "http",
            message: "디렉터리 서버 연결/서비스 계정 bind 에 실패했습니다.",
            retryable: true,
          },
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { ok: true },
        meta: { requestId: "req-1" },
      }),
    });
  });

  await page.route("**/api/v1/admin/settings", (route) => {
    if (route.request().method() === "PUT") {
      opts.onPut?.(route.request().postDataJSON());
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: SETTINGS }),
    });
  });

  await page.route("**/api/v1/admin/tools", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { allowedTools: [] } }),
    }),
  );

  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "user-1",
            email: "admin@example.com",
            name: "관리자",
            orgId: "org-1",
            role: "admin",
            customInstructions: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          org: {
            id: "org-1",
            name: "Acme",
            domain: "acme.test",
            plan: "pro",
            allowedModels: ["claude-sonnet-5"],
            allowedTools: [],
            defaultTokenBudgetMicros: null,
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
    }),
  );
}

async function openIdentityTab(page: import("@playwright/test").Page) {
  await page.goto("/preview");
  const screen = page.getByTestId("preview-admin-settings-screen");
  await screen.getByTestId("admin-settings-screen-preview-trigger").click();
  await screen.getByRole("tab", { name: "Identity/LDAP" }).click();
  return screen;
}

test.describe("Identity/LDAP admin 패널", () => {
  test("저장된 설정 렌더 → 그룹매핑 추가 → 연결 테스트 성공 → 저장 왕복", async ({
    page,
  }) => {
    let putBody: unknown = null;
    await mockBackend(page, {
      onPut: (body) => {
        putBody = body;
      },
    });
    const screen = await openIdentityTab(page);

    // 저장된 값이 실제로 화면에 나온다.
    await expect(screen.getByTestId("admin-settings-ldapUrl")).toHaveValue(
      "ldaps://dc.example.com:636",
    );
    await expect(screen.getByTestId("admin-settings-ldapBaseDn")).toHaveValue(
      "OU=Users,DC=example,DC=com",
    );
    await expect(
      screen.getByTestId("admin-settings-ldapGroupRoleMap-list"),
    ).toContainText("CN=Admins,DC=example,DC=com");

    // 연결 테스트 — 성공 사유가 화면에 표면화된다.
    await screen.getByTestId("admin-settings-ldap-test").click();
    await expect(
      screen.getByTestId("admin-settings-ldap-test-result"),
    ).toContainText("연결 성공");

    // 그룹 → 역할 매핑 추가 후 저장하면 PUT body 에 실린다.
    await screen
      .getByTestId("admin-settings-ldapGroupRoleMap-dn")
      .fill("CN=Staff,DC=example,DC=com");
    await screen
      .getByTestId("admin-settings-ldapGroupRoleMap-role")
      .selectOption("member");
    await screen.getByTestId("admin-settings-ldapGroupRoleMap-add").click();
    await expect(
      screen.getByTestId("admin-settings-ldapGroupRoleMap-list"),
    ).toContainText("CN=Staff,DC=example,DC=com");

    await screen
      .getByTestId("admin-settings-ldapBaseDn")
      .fill("OU=Staff,DC=example,DC=com");
    await expect(screen.getByTestId("admin-settings-save-bar")).toBeVisible();

    await screen.scrollIntoViewIfNeeded();
    await screen.screenshot({
      path: "../../.ralph/screenshots/P22-T6-22-identity-ldap.png",
    });

    await screen.getByTestId("admin-settings-save-button").click();
    await expect
      .poll(() => putBody, { message: "PUT /api/v1/admin/settings body" })
      .not.toBeNull();
    expect(putBody).toMatchObject({
      ldapEnabled: true,
      ldapBaseDn: "OU=Staff,DC=example,DC=com",
      ldapGroupRoleMap: {
        "CN=Admins,DC=example,DC=com": "admin",
        "CN=Staff,DC=example,DC=com": "member",
      },
    });
  });

  test("디렉터리 장애(502) 사유가 패널에 표면화된다", async ({ page }) => {
    await mockBackend(page, { ldapTestFails: true });
    const screen = await openIdentityTab(page);

    await screen.getByTestId("admin-settings-ldap-test").click();
    await expect(
      screen.getByTestId("admin-settings-ldap-test-result"),
    ).toContainText("디렉터리 서버 연결/서비스 계정 bind 에 실패했습니다.");

    await screen.scrollIntoViewIfNeeded();
    await screen.screenshot({
      path: "../../.ralph/screenshots/P22-T6-22-ldap-test-failed.png",
    });
  });
});

import { test, expect } from "@playwright/test";

// e2e/admin-settings.pw.ts — P14-T6-01/03 브라우저 검증(Layer 1).
//   /preview 의 admin-settings-screen 섹션을 실제 chromium 으로 열어 7탭 셸이
//   design-reference 핸드오프대로 렌더/전환되는지 검증한다. GET 은 page.route() 로 목킹.
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
  banner: [] as Array<{
    type: "info" | "success" | "warning" | "error";
    title?: string;
    content: string;
    dismissible: boolean;
  }>,
  responseWatermark: "",
  defaultUserRole: "member",
  enableSignup: false,
  maxUploadSizeMb: 25,
  maxUploadCount: 10,
};

async function mockBackend(
  page: import("@playwright/test").Page,
  onPut?: (body: unknown) => void,
  onToolsPut?: (body: unknown) => void,
) {
  await page.route("**/api/v1/admin/settings", (route) => {
    if (route.request().method() === "PUT") {
      onPut?.(route.request().postDataJSON());
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: SETTINGS }),
    });
  });
  // P22-T6-02: Connectors 탭의 allowedTools 편집 저장 → PUT /api/v1/admin/tools.
  await page.route("**/api/v1/admin/tools", (route) => {
    const body =
      route.request().method() === "PUT"
        ? (route.request().postDataJSON() as { allowedTools: string[] })
        : { allowedTools: [] };
    if (route.request().method() === "PUT") {
      onToolsPut?.(body);
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { allowedTools: body.allowedTools } }),
    });
  });
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
            allowedModels: ["claude-sonnet-5", "claude-opus-4-8"],
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

test.describe("P14 preview — 관리자 설정(P14-T6-01) 핸드오프 정렬", () => {
  test("7탭 셸이 렌더되고 전환된다(라이트)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const settingsScreen = page.getByTestId("preview-admin-settings-screen");
    await expect(settingsScreen).toBeVisible();
    await settingsScreen
      .getByTestId("admin-settings-screen-preview-trigger")
      .click();

    await expect(
      settingsScreen.getByRole("tab", { name: "Models & Generation" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      settingsScreen.getByTestId("admin-settings-panel-models"),
    ).toBeVisible();
    await expect(
      settingsScreen.getByTestId("admin-settings-maxTokens"),
    ).toHaveValue("4096");
    await expect(
      settingsScreen.getByTestId("admin-settings-defaultModel"),
    ).toHaveValue("claude-sonnet-5");
    await expect(
      settingsScreen.getByTestId("admin-settings-topP-hint"),
    ).toHaveCount(0);
    await expect(
      settingsScreen.getByTestId("admin-settings-allowedModels-list"),
    ).toContainText("claude-opus-4-8");

    await settingsScreen.getByTestId("admin-settings-maxTokens").fill("8192");
    await expect(
      settingsScreen.getByTestId("admin-settings-save-bar"),
    ).toBeVisible();

    await settingsScreen.getByRole("tab", { name: "Knowledge/RAG" }).click();
    await expect(
      settingsScreen.getByRole("tab", { name: "Knowledge/RAG" }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      settingsScreen.getByTestId("admin-settings-panel-rag"),
    ).toBeVisible();
    await expect(
      settingsScreen.getByTestId("admin-settings-ragTopK"),
    ).toHaveValue("10");

    await settingsScreen.getByRole("tab", { name: "Web Search" }).click();
    await expect(
      settingsScreen.getByTestId("admin-settings-webSearchResultCount"),
    ).toHaveValue("3");

    await settingsScreen.getByRole("tab", { name: "Connectors/MCP" }).click();
    // P22-T6-02: allowedTools 는 더 이상 읽기전용이 아니라 편집 입력/추가/저장 컨트롤을 노출한다.
    await expect(
      settingsScreen.getByTestId("admin-settings-allowedTools-hint"),
    ).not.toContainText("읽기 전용");
    await expect(
      settingsScreen.getByTestId("admin-settings-allowedTools-input"),
    ).toBeVisible();

    await settingsScreen.getByRole("tab", { name: "General/Branding" }).click();
    await expect(
      settingsScreen.getByTestId("admin-settings-instanceName"),
    ).toHaveValue("WChat");

    await settingsScreen
      .getByRole("tab", { name: "Users & Permissions" })
      .click();
    await expect(
      settingsScreen.getByTestId("admin-settings-defaultUserRole-hint"),
    ).toHaveCount(0);
    await expect(
      settingsScreen.getByTestId("admin-settings-enableSignup-hint"),
    ).toHaveCount(0);

    await settingsScreen.getByRole("tab", { name: "Quota/Limits" }).click();
    await expect(
      settingsScreen.getByTestId("admin-settings-maxUploadSizeMb"),
    ).toHaveValue("25");
    await expect(
      settingsScreen.getByTestId("admin-settings-defaultTokenBudgetMicros"),
    ).toContainText("제한 없음");

    await settingsScreen
      .getByRole("tab", { name: "Models & Generation" })
      .click();
    await settingsScreen.scrollIntoViewIfNeeded();
    await settingsScreen.screenshot({
      path: "../../.ralph/screenshots/admin-settings-screen-light.png",
    });
  });

  test("다크 테마에서도 관리자 설정 화면이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const settingsScreen = page.getByTestId("preview-admin-settings-screen");
    await settingsScreen
      .getByTestId("admin-settings-screen-preview-trigger")
      .click();
    await expect(
      settingsScreen.getByRole("tab", { name: "Models & Generation" }),
    ).toHaveAttribute("aria-selected", "true");
    await settingsScreen.scrollIntoViewIfNeeded();
    await settingsScreen.screenshot({
      path: "../../.ralph/screenshots/admin-settings-screen-dark.png",
    });
  });

  test("P20-T6-04: General/Branding 탭에서 typed 배너를 저작해 저장한다", async ({
    page,
  }) => {
    let putBody: unknown = null;
    await mockBackend(page, (body) => {
      putBody = body;
    });
    await page.goto("/preview");

    const settingsScreen = page.getByTestId("preview-admin-settings-screen");
    await settingsScreen
      .getByTestId("admin-settings-screen-preview-trigger")
      .click();
    await settingsScreen.getByRole("tab", { name: "General/Branding" }).click();

    await expect(
      settingsScreen.getByText("등록된 배너가 없습니다."),
    ).toBeVisible();

    await settingsScreen.getByTestId("admin-settings-banner-add").click();
    await expect(
      settingsScreen.getByTestId("admin-settings-banner-0"),
    ).toBeVisible();
    await settingsScreen
      .getByTestId("admin-settings-banner-0-type")
      .selectOption("warning");
    await settingsScreen
      .getByTestId("admin-settings-banner-0-title")
      .fill("점검 안내");
    await settingsScreen
      .getByTestId("admin-settings-banner-0-content")
      .fill("오늘 밤 시스템 점검이 있습니다.");

    await settingsScreen.getByTestId("admin-settings-save-button").click();

    await expect
      .poll(() => putBody, { message: "PUT /api/v1/admin/settings body" })
      .not.toBeNull();
    expect(putBody).toMatchObject({
      banner: [
        {
          type: "warning",
          title: "점검 안내",
          content: "오늘 밤 시스템 점검이 있습니다.",
          dismissible: true,
        },
      ],
    });
  });

  test("P22-T6-02: Connectors 탭에서 도구를 추가·저장하면 PUT /api/v1/admin/tools 를 호출한다", async ({
    page,
  }) => {
    let toolsBody: unknown = null;
    await mockBackend(page, undefined, (body) => {
      toolsBody = body;
    });
    await page.goto("/preview");

    const settingsScreen = page.getByTestId("preview-admin-settings-screen");
    await settingsScreen
      .getByTestId("admin-settings-screen-preview-trigger")
      .click();
    await settingsScreen.getByRole("tab", { name: "Connectors/MCP" }).click();

    await settingsScreen
      .getByTestId("admin-settings-allowedTools-input")
      .fill("web_search");
    await settingsScreen.getByTestId("admin-settings-allowedTools-add").click();
    await expect(
      settingsScreen.getByTestId("admin-settings-allowedTools-list"),
    ).toContainText("web_search");
    await settingsScreen
      .getByTestId("admin-settings-allowedTools-save")
      .click();

    await expect
      .poll(() => toolsBody, { message: "PUT /api/v1/admin/tools body" })
      .not.toBeNull();
    expect(toolsBody).toEqual({ allowedTools: ["web_search"] });
  });
});

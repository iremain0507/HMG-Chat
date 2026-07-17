import { test, expect } from "@playwright/test";

// e2e/command-palette-shortcut-sheet-focus-trap.pw.ts — P21-T6-10 브라우저 검증(Layer 1, ★needsBrowser).
//   CommandPalette(⌘K)·ShortcutSheet(⌘/) 는 Escape·배경클릭은 있었으나 포커스 트랩·복귀가 없었다
//   (Tab 이 배경 요소로 침투). useFocusTrap 이식 후 실 chromium 으로 UX-09/10 을 단언한다.
async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          user: {
            id: "user-1",
            email: "kim@example.com",
            name: "김민수",
            orgId: "org-1",
            role: "admin",
            customInstructions: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          org: null,
        },
      }),
    }),
  );
  await page.route("**/api/v1/folders", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
  await page.route("**/api/v1/sessions", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
}

test.describe("P21-T6-10 preview — CommandPalette/ShortcutSheet focus-trap", () => {
  test("ShortcutSheet: 열면 닫기 버튼에 포커스, Tab 은 트랩되고, Escape 닫으면 트리거로 복귀한다(UX-09/10)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const trigger = shell.getByTestId("app-shell-shortcuts-button");
    await trigger.click();

    const sheet = shell.getByTestId("shortcut-sheet");
    await expect(sheet).toBeVisible();
    const closeButton = sheet.getByLabel("닫기");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("CommandPalette: 열면 검색창에 포커스, Escape 닫으면 트리거(⌘K)로 복귀한다(UX-09/10)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const trigger = shell.getByTestId("app-shell-cmdk-button");
    await trigger.click();

    const palette = page.getByTestId("command-palette");
    await expect(palette).toBeVisible();
    await expect(page.getByTestId("command-palette-input")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

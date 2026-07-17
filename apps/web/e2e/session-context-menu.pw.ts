import { test, expect } from "@playwright/test";

// e2e/session-context-menu.pw.ts — P21-T6-03 브라우저 검증(Layer 1, ★needsBrowser).
//   시드버그: 세션 우클릭 컨텍스트 메뉴가 바깥클릭·Escape 로 안 닫히고, 다른 세션 우클릭 시
//   메뉴가 동시에 여러 개 열린다. /preview 의 SessionList(AppShell 사이드바)를 실 chromium 으로
//   열어 실제 우클릭×2/바깥클릭/Escape 로 UX-01~03 을 단언한다(session-bulk-actions.pw.ts 와
//   동일한 page.route() 목킹 패턴).
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
      body: JSON.stringify({
        data: [
          {
            id: "s-a",
            title: "세션 A",
            lastMessageAt: "2026-07-17T08:00:00Z",
            projectId: null,
            archived: false,
            pinned: false,
            folderId: null,
            tags: [],
          },
          {
            id: "s-b",
            title: "세션 B",
            lastMessageAt: "2026-07-17T08:00:00Z",
            projectId: null,
            archived: false,
            pinned: false,
            folderId: null,
            tags: [],
          },
        ],
      }),
    });
  });
}

test.describe("P21-T6-03 preview — 세션 컨텍스트 메뉴 dismiss 계약(시드버그)", () => {
  test("카드A 우클릭 후 카드B 우클릭하면 A 메뉴만 닫히고 B 메뉴 1개만 보인다(UX-02)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    await expect(sidebar.getByText("세션 A")).toBeVisible();
    await expect(sidebar.getByText("세션 B")).toBeVisible();

    const cardA = sidebar.getByTestId("session-card-s-a");
    const cardB = sidebar.getByTestId("session-card-s-b");

    await cardA.click({ button: "right" });
    await expect(sidebar.getByTestId("context-menu-s-a")).toBeVisible();

    // A 의 드롭다운(우측 정렬)이 B 카드 우측 일부를 겹쳐 덮으므로, 실사용자가 실제로 클릭 가능한
    // B 카드 좌측 여백을 우클릭한다(카드 중앙 클릭 시 A 메뉴가 포인터 이벤트를 가로챔).
    await cardB.click({ button: "right", position: { x: 5, y: 5 } });
    await expect(sidebar.getByTestId("context-menu-s-a")).toHaveCount(0);
    await expect(sidebar.getByTestId("context-menu-s-b")).toBeVisible();
    await expect(sidebar.getByTestId("context-menu-s-b")).toHaveCount(1);
  });

  test("메뉴 밖을 클릭하면 닫힌다(UX-01)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    const cardA = sidebar.getByTestId("session-card-s-a");

    await cardA.click({ button: "right" });
    await expect(sidebar.getByTestId("context-menu-s-a")).toBeVisible();

    await page.mouse.click(10, 10);
    await expect(sidebar.getByTestId("context-menu-s-a")).toHaveCount(0);
  });

  test("Escape 를 누르면 닫힌다(UX-03)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    const cardA = sidebar.getByTestId("session-card-s-a");

    await cardA.click({ button: "right" });
    await expect(sidebar.getByTestId("context-menu-s-a")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sidebar.getByTestId("context-menu-s-a")).toHaveCount(0);
  });
});

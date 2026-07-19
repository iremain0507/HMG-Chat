import { test, expect } from "@playwright/test";

// e2e/session-clone.pw.ts — P22-T6-01 브라우저 검증(Layer B, ★needsBrowser).
//   Open WebUI 의 conversation duplicate 대응. /preview 의 SessionList(AppShell 사이드바)를 실
//   chromium 으로 열어, 세션 카드 우클릭 컨텍스트 메뉴의 "복제" menuitem 을 실제로 클릭하면
//   POST /api/v1/sessions/:id/clone 응답 세션이 목록 최상단에 prepend 되는지 단언한다
//   (session-context-menu.pw.ts 와 동일한 page.route() 목킹 패턴).
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
  // POST /sessions/s-a/clone — 원본 title 을 복사한 새 세션 DTO 를 201 로 반환(서버 계약 shape).
  await page.route("**/api/v1/sessions/s-a/clone", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          id: "s-a-copy",
          title: "세션 A",
          projectId: null,
          createdAt: "2026-07-17T09:00:00Z",
        },
        meta: { requestId: "req-clone-1" },
      }),
    }),
  );
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

test.describe("P22-T6-01 preview — 세션 복제(conversation duplicate)", () => {
  test("컨텍스트 메뉴 '복제' 클릭 시 복제된 세션이 목록 최상단에 추가된다", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    await expect(sidebar.getByTestId("session-card-s-a")).toBeVisible();
    // 복제 전에는 원본 s-a 만 존재하고 복제본은 없다.
    await expect(sidebar.getByTestId("session-card-s-a-copy")).toHaveCount(0);

    const cardA = sidebar.getByTestId("session-card-s-a");
    await cardA.click({ button: "right" });
    const menu = sidebar.getByTestId("context-menu-s-a");
    await expect(menu).toBeVisible();

    await menu.getByRole("menuitem", { name: "복제" }).click();

    // 복제본(s-a-copy)이 나타나고, prepend 되어 원본 s-a 보다 위(먼저)에 온다.
    const copy = sidebar.getByTestId("session-card-s-a-copy");
    await expect(copy).toBeVisible();
    // 복제가 끝나면 컨텍스트 메뉴는 닫힌다.
    await expect(sidebar.getByTestId("context-menu-s-a")).toHaveCount(0);

    const cardIds = await sidebar
      .locator('[data-testid^="session-card-"]')
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-testid")));
    expect(cardIds.indexOf("session-card-s-a-copy")).toBeLessThan(
      cardIds.indexOf("session-card-s-a"),
    );
  });
});

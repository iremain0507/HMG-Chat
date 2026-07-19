import { test, expect } from "@playwright/test";

// e2e/session-bulk-actions.pw.ts — P20-T6-08 브라우저 검증(Layer 1).
//   /preview 의 SessionList(AppShell 사이드바)를 실제 chromium 으로 열어 다중 선택 모드로
//   전환 후 체크박스 3개 선택 → 일괄 보관 클릭 시 실제로 3건 모두 사이드바에서 사라지는지
//   (신규 route 없이 기존 PATCH /:id/archive 클라 루프 호출로) 검증한다. useSessions 의 fetch 는
//   실 서버 없이도 재현 가능하도록 page.route() 로 목킹한다(nested-folders.pw.ts 와 동일 패턴).
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
          {
            id: "s-c",
            title: "세션 C",
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
  await page.route("**/api/v1/sessions/*/archive", (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const id = route
      .request()
      .url()
      .match(/sessions\/([^/]+)\/archive/)?.[1];
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { id, archived: true } }),
    });
  });
}

test.describe("P20-T6-08 preview — 다중 선택 + 일괄 보관", () => {
  test("체크박스로 3개 선택 후 일괄 보관하면 실제로 3건 모두 사이드바에서 사라진다", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    await expect(sidebar).toBeVisible();

    await expect(sidebar.getByText("세션 A")).toBeVisible();
    await expect(sidebar.getByText("세션 B")).toBeVisible();
    await expect(sidebar.getByText("세션 C")).toBeVisible();

    await sidebar.getByRole("button", { name: "다중 선택" }).click();

    await sidebar.getByLabel("선택: 세션 A").check();
    await sidebar.getByLabel("선택: 세션 B").check();
    await sidebar.getByLabel("선택: 세션 C").check();

    await expect(sidebar.getByText("3개 선택됨")).toBeVisible();

    await sidebar.getByRole("button", { name: "선택 항목 보관" }).click();

    await expect(sidebar.getByText("세션 A")).toHaveCount(0);
    await expect(sidebar.getByText("세션 B")).toHaveCount(0);
    await expect(sidebar.getByText("세션 C")).toHaveCount(0);
  });
});

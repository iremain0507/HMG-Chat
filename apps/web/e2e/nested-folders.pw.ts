import { test, expect } from "@playwright/test";

// e2e/nested-folders.pw.ts — P20-T1-06 브라우저 검증(Layer 1).
//   /preview 의 SessionList(AppShell 사이드바)를 실제 chromium 으로 열어 parentFolderId 계층이
//   실제로 들여쓰기·접기전파·세션 소속으로 렌더되는지 검증한다. useSessions 의 fetch 는
//   실 서버 없이도 재현 가능하도록 page.route() 로 목킹한다(app-shell.pw.ts 와 동일 패턴).
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
      body: JSON.stringify({
        data: [
          {
            id: "folder-parent",
            name: "부모 폴더",
            systemPrompt: null,
            parentFolderId: null,
            createdAt: "2026-07-15T00:00:00Z",
          },
          {
            id: "folder-child",
            name: "자식 폴더",
            systemPrompt: null,
            parentFolderId: "folder-parent",
            createdAt: "2026-07-15T00:00:00Z",
          },
        ],
      }),
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
            id: "s-nested",
            title: "자식 폴더에 속한 세션",
            lastMessageAt: "2026-07-15T08:00:00Z",
            projectId: null,
            archived: false,
            pinned: false,
            folderId: "folder-child",
            tags: [],
          },
        ],
      }),
    });
  });
}

test.describe("P20-T1-06 preview — 중첩 폴더(parent_folder_id 계층)", () => {
  test("자식 폴더는 부모보다 들여쓰기되어 렌더되고, 부모를 접으면 자식도 함께 숨겨지며, 세션은 자식 폴더 아래 렌더된다", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    const sidebar = shell.getByTestId("app-shell-sidebar");
    await expect(sidebar).toBeVisible();

    const parentHeader = sidebar.getByTestId("folder-header-folder-parent");
    const childHeader = sidebar.getByTestId("folder-header-folder-child");
    await expect(parentHeader).toBeVisible();
    await expect(childHeader).toBeVisible();

    // 들여쓰기 — 헤더 div 자체의 좌측 시작점은 두 레벨 모두 동일(부모 컨테이너 폭 100%)하므로
    // padding-left 로 밀려나는 내부 콘텐츠(폴더명 텍스트)의 좌측 시작점을 비교해야 한다.
    const parentLabel = parentHeader.locator("span.truncate");
    const childLabel = childHeader.locator("span.truncate");
    const parentBox = await parentLabel.boundingBox();
    const childBox = await childLabel.boundingBox();
    if (!parentBox || !childBox) {
      throw new Error("folder label bounding box not found");
    }
    expect(childBox.x).toBeGreaterThan(parentBox.x);

    const parentPaddingLeft = await parentHeader.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    const childPaddingLeft = await childHeader.evaluate(
      (el) => window.getComputedStyle(el).paddingLeft,
    );
    expect(parseFloat(childPaddingLeft)).toBeGreaterThan(
      parseFloat(parentPaddingLeft),
    );

    // 세션은 중첩(자식) 폴더 아래 렌더된다.
    await expect(sidebar).toContainText("자식 폴더에 속한 세션");

    // 부모 폴더를 접으면 자식 폴더(및 그 세션)도 함께 사라진다.
    await sidebar.getByRole("button", { name: "접기: 부모 폴더" }).click();
    await expect(childHeader).toHaveCount(0);
    await expect(sidebar.getByText("자식 폴더에 속한 세션")).toHaveCount(0);

    // 다시 펼치면 복원된다.
    await sidebar.getByRole("button", { name: "펼치기: 부모 폴더" }).click();
    await expect(childHeader).toBeVisible();
    await expect(sidebar).toContainText("자식 폴더에 속한 세션");
  });
});

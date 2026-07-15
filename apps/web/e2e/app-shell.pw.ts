import { test, expect } from "@playwright/test";

// e2e/app-shell.pw.ts — P13-T6-01 브라우저 검증(Layer 1).
//   /preview 의 AppShell 섹션을 실제 chromium 으로 열어 헤더/나비레일/세션사이드바/우패널이
//   design-reference 핸드오프대로 렌더되는지, ⌘\ 토글·드래그 리사이즈·세션 고정(hover)이
//   실제 CSS/마우스 이벤트로 동작하는지 검증한다. useSessions/useCurrentUser 의 fetch 는
//   실 서버 없이도 재현 가능하도록 page.route() 로 목킹한다.
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
  await page.route("**/api/v1/sessions", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [
          {
            id: "s1",
            title: "등속조인트 공정 불량 원인 분석",
            lastMessageAt: "2026-07-15T08:00:00Z",
            projectId: null,
            archived: false,
          },
          {
            id: "s2",
            title: "전기차 열관리 시장 동향 조사",
            lastMessageAt: "2026-07-14T08:00:00Z",
            projectId: null,
            archived: false,
          },
        ],
      }),
    });
  });
}

test.describe("P13 preview — AppShell 핸드오프 정렬", () => {
  test("헤더·나비레일·세션사이드바·우패널이 렌더되고 admin 항목/아바타가 노출된다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    await expect(shell).toBeVisible();
    await expect(shell.getByTestId("app-shell-header")).toContainText("WChat");
    await expect(shell.getByTestId("app-shell-nav-rail")).toBeVisible();
    await expect(shell.getByTestId("nav-rail-admin")).toBeVisible();
    await expect(shell.getByTestId("nav-rail-avatar")).toHaveText("김");
    await expect(shell.getByTestId("app-shell-sidebar")).toContainText(
      "등속조인트 공정 불량 원인 분석",
    );
    await expect(shell.getByTestId("app-shell-right-panel")).toBeVisible();

    await shell.screenshot({
      path: "../../.ralph/screenshots/app-shell-light.png",
    });
  });

  test("다크 테마에서도 정상 렌더되고 ⌘\\ 토글·드래그 리사이즈·세션 고정이 동작한다", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");

    const shell = page
      .getByTestId("preview-app-shell")
      .getByTestId("app-shell");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(shell).toBeVisible();

    // ⌘\ 우패널 토글
    const rightPanel = shell.getByTestId("app-shell-right-panel");
    await expect(rightPanel).toBeVisible();
    await page.keyboard.down("Meta");
    await page.keyboard.press("\\");
    await page.keyboard.up("Meta");
    await expect(rightPanel).toHaveCount(0);
    await shell.getByTestId("app-shell-panel-toggle").click();
    await expect(rightPanel).toBeVisible();

    // 드래그 리사이즈 — 400px 기본값에서 왼쪽으로 끌면 폭이 넓어진다
    const handle = shell.getByTestId("app-shell-right-panel-resize-handle");
    const box = await handle.boundingBox();
    if (!box) throw new Error("resize handle not found");
    await page.mouse.move(box.x + 1, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x - 60, box.y + box.height / 2);
    await page.mouse.up();
    const widthAfter = await rightPanel.evaluate(
      (el) => el.getBoundingClientRect().width,
    );
    expect(widthAfter).toBeGreaterThan(440);

    // 세션 카드 hover → 고정 버튼 클릭 → '고정' 그룹으로 이동(실 hover 필요, RTL 로는 검증 불가)
    const sidebar = shell.getByTestId("app-shell-sidebar");
    const firstCard = sidebar.getByTestId("session-card-s1");
    await firstCard.hover();
    await firstCard.getByLabel(/^고정: /).click();
    await expect(sidebar.getByText("고정")).toBeVisible();

    await shell.screenshot({
      path: "../../.ralph/screenshots/app-shell-dark.png",
    });
  });
});

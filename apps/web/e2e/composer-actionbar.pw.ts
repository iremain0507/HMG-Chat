import { test, expect } from "@playwright/test";

// e2e/composer-actionbar.pw.ts — P13-T6-04 브라우저 검증(Layer 1).
//   컴포저(F05) 핸드오프 정렬 — 액션바 [＋][@][/] · 모델칩 · 에이전트|채팅 세그먼트 ·
//   웹검색 토글 · 컨텍스트 게이지(mono) 및 @멘션 팝오버(카테고리 탭 + 정책 배지)가 실제
//   chromium 에서 렌더/상호작용하는지 검증한다.
test.describe("P13 preview — 컴포저(F05) 핸드오프 정렬", () => {
  test("액션바 버튼·세그먼트 토글·컨텍스트 게이지가 렌더되고 동작한다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    await expect(section).toBeVisible();

    const textarea = section.getByLabel("메시지 입력");

    // [@] 액션바 버튼 → 멘션 팝오버 + 카테고리 탭 + 정책 배지
    await section.getByTestId("composer-trigger-mention").click();
    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();
    await expect(
      popover.getByTestId("composer-popover-tab-agent"),
    ).toBeVisible();
    await expect(popover.getByText("읽기 전용")).toBeVisible();
    await expect(popover.getByText("승인 필요")).toBeVisible();

    await popover.getByTestId("composer-popover-tab-connector").click();
    await expect(popover.getByText("work_order.update")).toBeVisible();
    await expect(popover.getByText("품질 리포트")).toHaveCount(0);

    await textarea.press("Escape");
    await expect(popover).toBeHidden();
    await textarea.fill("");

    // [/] 액션바 버튼 — 입력이 비어있을 때만 활성화
    const slashButton = section.getByTestId("composer-trigger-slash");
    await expect(slashButton).toBeEnabled();
    await slashButton.click();
    await expect(popover).toBeVisible();
    await textarea.press("Escape");
    await textarea.fill("");

    await textarea.fill("작성 중");
    await expect(slashButton).toBeDisabled();
    await textarea.fill("");

    // 에이전트|채팅 세그먼트 토글
    const agentTab = section.getByTestId("model-picker-mode-agent");
    const chatTab = section.getByTestId("model-picker-mode-chat");
    await expect(agentTab).toHaveAttribute("aria-pressed", "true");
    await chatTab.click();
    await expect(chatTab).toHaveAttribute("aria-pressed", "true");
    await expect(agentTab).toHaveAttribute("aria-pressed", "false");

    // 컨텍스트 게이지(mono)
    await expect(section.getByTestId("composer-context-gauge")).toHaveText(
      "8%",
    );

    await section.screenshot({
      path: "../../.ralph/screenshots/composer-actionbar-light.png",
    });
  });

  test("다크 테마에서도 액션바·팝오버가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");

    const section = page.getByTestId("preview-chat-input");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(section).toBeVisible();

    await section.getByTestId("composer-trigger-mention").click();
    await expect(section.getByTestId("composer-popover")).toBeVisible();

    await section.screenshot({
      path: "../../.ralph/screenshots/composer-actionbar-dark.png",
    });
  });
});

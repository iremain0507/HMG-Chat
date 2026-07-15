import { test, expect } from "@playwright/test";

// e2e/activity-panel.pw.ts — P13-T6-07 브라우저 검증(Layer 1).
//   F07(우패널 '활동' 탭) — 계획 요약 + 워커 카드(StatusChip+mono 출처 N) + 스텝 트레이스 +
//   하단 고정 [실행 중지]가 실제 chromium 에서 시맨틱 토큰 색으로 렌더되는지, 라이트/다크 각각 검증.
test.describe("P13 preview — 활동 패널(F07) 핸드오프 정렬", () => {
  test("계획 요약·워커 카드·스텝 트레이스·실행 중지 버튼이 렌더된다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-activity-panel");
    await expect(section).toBeVisible();

    const panel = section.getByTestId("activity-panel");
    await expect(panel.getByTestId("activity-plan-summary")).toContainText(
      "4개",
    );

    const workers = [
      "activity-worker-sq-0",
      "activity-worker-sq-1",
      "activity-worker-sq-2",
      "activity-worker-sq-3",
    ];
    for (const id of workers) {
      await expect(panel.getByTestId(id)).toBeVisible();
    }
    await expect(panel.getByTestId("activity-worker-sq-0")).toContainText(
      "출처 9",
    );
    await expect(panel.getByTestId("activity-worker-sq-2")).toContainText(
      "실행 중",
    );

    await expect(panel.getByTestId("activity-step-planning")).toHaveAttribute(
      "data-status",
      "done",
    );
    await expect(
      panel.getByTestId("activity-step-researching"),
    ).toHaveAttribute("data-status", "running");
    await expect(panel.getByTestId("activity-step-planning")).toBeVisible();

    const stopButton = panel.getByTestId("activity-stop-button");
    await expect(stopButton).toBeEnabled();
    await stopButton.click();
    await expect(section.getByTestId("activity-panel-stopped")).toHaveText(
      "중지 요청됨",
    );

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/activity-panel-light.png",
    });
  });

  test("다크 테마에서도 활동 패널이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-activity-panel");
    const panel = section.getByTestId("activity-panel");
    await expect(panel.getByTestId("activity-worker-sq-0")).toBeVisible();
    await expect(panel.getByTestId("activity-stop-button")).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/activity-panel-dark.png",
    });
  });
});

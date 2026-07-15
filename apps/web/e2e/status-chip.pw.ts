import { test, expect } from "@playwright/test";

// e2e/status-chip.pw.ts — P13-T6-06 브라우저 검증(Layer 1).
//   StatusChip 5종(대기/실행 중/완료/오류/승인 필요)이 실제 chromium 에서 시맨틱 토큰 색으로
//   렌더되고, 라이트·다크 각각에서 정상 표시되는지 검증.
test.describe("P13 preview — StatusChip 5종 핸드오프 정렬", () => {
  test("5종 상태 라벨이 모두 렌더되고 running 도트만 펄스 클래스를 갖는다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-status-chip");
    await expect(section).toBeVisible();

    const chips = section.getByTestId("status-chip");
    await expect(chips).toHaveCount(5);

    const labels = ["대기", "실행 중", "완료", "오류", "승인 필요"];
    for (const label of labels) {
      await expect(section.getByText(label, { exact: true })).toBeVisible();
    }

    const runningChip = section.locator('[data-status="running"]');
    await expect(runningChip.getByTestId("status-chip-dot")).toHaveClass(
      /animate-\[pulse/,
    );

    const doneChip = section.locator('[data-status="done"]');
    await expect(doneChip.getByTestId("status-chip-dot")).not.toHaveClass(
      /animate-\[pulse/,
    );

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/status-chip-light.png",
    });
  });

  test("다크 테마에서도 5종 상태가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-status-chip");
    await expect(section.getByTestId("status-chip")).toHaveCount(5);
    await expect(section.getByText("승인 필요", { exact: true })).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/status-chip-dark.png",
    });
  });
});

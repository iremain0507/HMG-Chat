import { test, expect } from "@playwright/test";

// e2e/project-picker-memory-panel.pw.ts — P10-T6-14 브라우저 검증(Layer 1).
//   ProjectPicker(헤더 [Project ▾] 스코프 전환) + MemoryPanel(채팅 내 메모리 노출/토글)이
//   실제 chromium 에서 렌더/열기/선택/닫기 인터랙션이 동작하는지 검증.
test.describe("P10 preview — ProjectPicker & MemoryPanel", () => {
  test("프로젝트 피커가 열리고 프로젝트를 선택하면 트리거 라벨이 바뀐다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-project-picker");
    await expect(section).toBeVisible();

    const trigger = section.getByTestId("project-picker-trigger");
    await expect(trigger).toContainText("프로젝트 없음");

    await trigger.click();
    const menu = section.getByTestId("project-picker-menu");
    await expect(menu).toBeVisible();

    await menu.getByText("사내 정책").click();
    await expect(menu).toBeHidden();
    await expect(trigger).toContainText("사내 정책");

    await page.screenshot({
      path: "../../.ralph/screenshots/project-picker.png",
      fullPage: true,
    });
  });

  test("메모리 패널이 렌더되고 닫기/재오픈이 동작한다", async ({ page }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-memory-panel");
    await expect(section).toBeVisible();

    const panel = section.getByTestId("memory-panel");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("메모리");

    await panel.getByRole("button", { name: "닫기" }).click();
    await expect(panel).toBeHidden();

    await section
      .getByRole("button", { name: "메모리 패널 다시 열기" })
      .click();
    await expect(section.getByTestId("memory-panel")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/memory-panel.png",
      fullPage: true,
    });
  });
});

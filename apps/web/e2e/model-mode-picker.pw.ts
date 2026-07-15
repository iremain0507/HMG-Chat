import { test, expect } from "@playwright/test";

// e2e/model-mode-picker.pw.ts — P10-T6-13 브라우저 검증(Layer 1).
//   ChatInput 안 ModelModePicker(모델/추론강도/모드/웹검색)가 실제 chromium 에서 렌더되고
//   선택 변경이 반영되는지 검증.
test.describe("P10 preview — 모델/모드 피커", () => {
  test("모델/추론강도/모드 셀렉트가 렌더되고 선택을 변경할 수 있다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const picker = section.getByTestId("model-mode-picker");
    await expect(picker).toBeVisible();

    const modelSelect = section.getByLabel("모델 선택");
    await expect(modelSelect).toHaveValue("claude-opus-4-7");
    await modelSelect.selectOption("claude-sonnet-4-6");
    await expect(modelSelect).toHaveValue("claude-sonnet-4-6");

    const modeSelect = section.getByLabel("모드 선택");
    await modeSelect.selectOption("chat");
    await expect(modeSelect).toHaveValue("chat");

    const effortSelect = section.getByLabel("추론 강도");
    await effortSelect.selectOption("high");
    await expect(effortSelect).toHaveValue("high");

    await page.screenshot({
      path: "../../.ralph/screenshots/model-mode-picker.png",
      fullPage: true,
    });
  });

  test("웹검색 토글을 클릭하면 aria-pressed 가 반전된다", async ({ page }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const toggle = section.getByTestId("model-picker-websearch");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});

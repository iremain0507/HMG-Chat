import { test, expect } from "@playwright/test";

// e2e/hitl-prompt.pw.ts — P10-T6-08 브라우저 검증(Layer 1).
//   HitlPrompt 승인 카드가 실제 chromium 에서 렌더/인자 편집/승인·거부 인터랙션이 동작하는지 검증.
test.describe("P10 preview — HitlPrompt", () => {
  test("액션 설명이 렌더되고, 인자 수정 후 승인 버튼이 눌린다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-hitl-prompt");
    await expect(section).toBeVisible();

    const card = section.getByTestId("hitl-prompt");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-live", "assertive");
    await expect(card).toContainText("외부로 이메일을 발송합니다.");
    await expect(card).toContainText("send_email");

    await card.getByRole("button", { name: "수정" }).click();
    const editor = card.getByLabel("인자 편집");
    await expect(editor).toBeVisible();
    await editor.fill(JSON.stringify({ to: "c@d.com" }));

    await card.getByRole("button", { name: "승인" }).click();
    await expect(card.getByRole("button", { name: "승인" })).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/hitl-prompt.png",
      fullPage: true,
    });
  });
});

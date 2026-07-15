import { test, expect } from "@playwright/test";

// e2e/hitl-prompt.pw.ts — P13-T6-05 브라우저 검증(Layer 1).
//   HitlPrompt(F06) 딤 모달이 실제 chromium 에서 렌더/카운트다운/인자 편집/승인·거부·취소
//   인터랙션이 동작하는지, 라이트·다크 각각에서 정상 렌더되는지 검증.
test.describe("P13 preview — HitlPrompt(F06) 핸드오프 정렬", () => {
  test("경고 카드가 딤 모달로 렌더되고, 인자 수정 후 승인 버튼이 눌린다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-hitl-prompt");
    await expect(section).toBeVisible();
    await section.getByTestId("hitl-prompt-preview-trigger").click();

    const card = page.getByTestId("hitl-prompt");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("aria-live", "assertive");
    await expect(card).toHaveAttribute("aria-modal", "true");
    await expect(card).toContainText("도구 실행 승인이 필요합니다");
    await expect(card).toContainText("외부로 이메일을 발송합니다.");
    await expect(card).toContainText("send_email");
    await expect(card.getByTestId("hitl-countdown")).toContainText(
      "후 자동 거부",
    );

    await card.getByRole("button", { name: "수정 후 승인" }).click();
    const editor = card.getByLabel("인자 편집");
    await expect(editor).toBeVisible();
    await editor.fill(JSON.stringify({ to: "c@d.com" }));

    await page.screenshot({
      path: "../../.ralph/screenshots/hitl-prompt-light.png",
    });

    await card.getByRole("button", { name: "수정 후 승인" }).click();
    await expect(page.getByTestId("hitl-prompt")).toHaveCount(0);
  });

  test("다크 테마에서도 딤 모달·경고 색이 정상 렌더되고, 거부·취소가 동작한다", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-hitl-prompt");
    await section.getByTestId("hitl-prompt-preview-trigger").click();

    const card = page.getByTestId("hitl-prompt");
    await expect(card).toBeVisible();

    await card.getByRole("button", { name: "수정 후 승인" }).click();
    await expect(card.getByLabel("인자 편집")).toBeVisible();
    await card.getByRole("button", { name: "취소" }).click();
    await expect(
      card.getByRole("button", { name: "승인", exact: true }),
    ).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/hitl-prompt-dark.png",
    });

    await card.getByRole("button", { name: "거부" }).click();
    await expect(page.getByTestId("hitl-prompt")).toHaveCount(0);
  });
});

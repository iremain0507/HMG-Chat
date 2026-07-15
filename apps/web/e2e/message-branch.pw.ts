import { test, expect } from "@playwright/test";

// e2e/message-branch.pw.ts — P10-T6-15 브라우저 검증(Layer 1).
//   메시지 편집 → 새 분기 생성 → 형제 페이저(‹N/M›)로 분기 전환 → 활성경로 렌더가
//   실제 chromium 에서 동작하는지 검증(preview 갤러리는 로컬 state 로 SSE 를 흉내낸다).
test.describe("P10 preview — 메시지 편집/분기(트리)", () => {
  test("user 메시지를 편집하면 새 분기가 생기고, 페이저로 형제 분기를 오갈 수 있다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-message-branch");
    await expect(section).toBeVisible();
    await expect(section.getByText("원본 질문입니다.")).toBeVisible();
    await expect(section.getByTestId("message-branch-pager")).toBeHidden();

    await section.getByRole("button", { name: "편집" }).click();
    const editor = section.getByLabel("메시지 편집");
    await expect(editor).toBeVisible();
    await editor.fill("편집된 질문입니다.");
    await section.getByRole("button", { name: "저장" }).click();

    await expect(section.getByText("편집된 질문입니다.")).toBeVisible();
    await expect(section.getByText("원본 질문입니다.")).toBeHidden();
    await expect(section.getByTestId("message-branch-pager")).toHaveText(
      "2 / 2",
    );

    await section.getByRole("button", { name: "이전 분기" }).click();
    await expect(section.getByText("원본 질문입니다.")).toBeVisible();
    await expect(section.getByText("이것이 첫 번째 응답입니다.")).toBeVisible();
    await expect(section.getByTestId("message-branch-pager")).toHaveText(
      "1 / 2",
    );
    await expect(
      section.getByRole("button", { name: "이전 분기" }),
    ).toBeDisabled();

    await section.getByRole("button", { name: "다음 분기" }).click();
    await expect(section.getByText("편집된 질문입니다.")).toBeVisible();
    await expect(
      section.getByRole("button", { name: "다음 분기" }),
    ).toBeDisabled();

    await page.screenshot({
      path: "../../.ralph/screenshots/message-branch.png",
      fullPage: true,
    });
  });
});

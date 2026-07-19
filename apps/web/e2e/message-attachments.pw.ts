import { test, expect } from "@playwright/test";

// e2e/message-attachments.pw.ts — P22-T6-04 브라우저 검증(Layer 1, /preview).
//   유저 메시지 버블의 이미지 첨부가 파일명 대신 실제 썸네일(<img>)로,
//   비이미지 첨부는 파일명 칩으로 렌더되는지 실 chromium 에서 확인(멀티모달 파리티).
test.describe("P22 preview — 메시지 버블 첨부 썸네일", () => {
  test("이미지 첨부는 <img> 썸네일로, 비이미지는 파일명 칩으로 렌더된다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-message-attachments");
    await expect(section).toBeVisible();

    // 이미지 첨부 → alt=파일명 을 가진 <img> 썸네일
    const thumb = section.getByRole("img", { name: "photo.png" });
    await expect(thumb).toBeVisible();
    await expect(thumb).toHaveJSProperty("naturalWidth", 80);

    // 비이미지 첨부 → 파일명 칩(썸네일 없음)
    await expect(section.getByRole("img", { name: "spec.pdf" })).toHaveCount(0);
    await expect(section.getByText("spec.pdf")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/P22-T6-04-message-attachments.png",
      fullPage: true,
    });
  });
});

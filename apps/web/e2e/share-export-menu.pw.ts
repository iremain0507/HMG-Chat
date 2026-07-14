import { test, expect } from "@playwright/test";

// e2e/share-export-menu.pw.ts — P10-T6-16 브라우저 검증(Layer 1).
//   ShareExportMenu(채팅 헤더 [공유/내보내기 ▾]) — md/JSON 내보내기 다운로드 트리거 +
//   대화 공유 opt-in 확인 → 기존 ShareDialog 오픈까지 실 chromium 인터랙션 검증.
test.describe("P10 preview — ShareExportMenu", () => {
  test("메뉴가 열리고 마크다운 내보내기 클릭 시 파일이 다운로드된다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-share-export-menu");
    await expect(section).toBeVisible();

    await section.getByTestId("share-export-trigger").click();
    const menu = section.getByTestId("share-export-menu");
    await expect(menu).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await menu.getByRole("button", { name: "마크다운으로 내보내기" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("WChat 대화.md");

    await expect(menu).toBeHidden();
  });

  test("대화 공유는 opt-in 확인을 거쳐야 공유 다이얼로그가 열린다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-share-export-menu");
    await section.getByTestId("share-export-trigger").click();
    await section.getByRole("button", { name: "대화 공유" }).click();

    const confirm = section.getByTestId("share-confirm");
    await expect(confirm).toBeVisible();
    await expect(page.getByRole("dialog", { name: "공유" })).toHaveCount(0);

    await section.getByTestId("share-confirm-accept").click();
    await expect(page.getByRole("dialog", { name: "공유" })).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/share-export-menu.png",
      fullPage: true,
    });
  });
});

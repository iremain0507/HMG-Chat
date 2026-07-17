import { test, expect } from "@playwright/test";

// e2e/message-info.pw.ts — P20-T6-06 브라우저 검증(Layer 1, ★needsBrowser).
//   생성 메타(Info) 팝오버 — /preview 의 message-actions 섹션(meta 고정 fixture)을 실제
//   chromium 으로 열어 "정보" 버튼 클릭 시 토큰/경과시간/모델이 실제 DOM 팝오버로 렌더되는지
//   검증한다. 실앱 dev-login E2E 하네스는 이 세션에 아직 없어(§2), 기존 코드베이스 관례대로
//   /preview 갤러리(실 chromium 렌더, verify-browser.sh)를 브라우저 레이어로 사용한다.
test.describe("P20 preview — 생성 메타(Info) 표시", () => {
  test("정보 버튼 클릭 시 토큰 수·경과시간·모델이 팝오버에 렌더된다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-message-actions");
    await expect(section).toBeVisible();

    const infoButton = section.getByRole("button", { name: "정보" });
    await expect(infoButton).toBeVisible();

    const popover = section.getByTestId("message-info-popover");
    await expect(popover).toBeHidden();

    await infoButton.click();
    await expect(popover).toBeVisible();
    await expect(popover).toContainText("128");
    await expect(popover).toContainText("256");
    await expect(popover).toContainText("1.8초");
    await expect(popover).toContainText("fake-model");

    await section.screenshot({
      path: "../../.ralph/screenshots/message-info.png",
    });
  });
});

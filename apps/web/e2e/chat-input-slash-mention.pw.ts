import { test, expect } from "@playwright/test";

// e2e/chat-input-slash-mention.pw.ts — P10-T6-12 브라우저 검증(Layer 1).
//   ChatInput 슬래시(/) 액션 팝오버 + @멘션 엔티티 픽커가 실제 chromium 에서
//   타이핑→필터→클릭 선택으로 동작하는지 검증(콜백 실행/참조 토큰 삽입).
test.describe("P10 preview — ChatInput 슬래시/멘션", () => {
  test("/ 입력 시 필터된 명령 팝오버가 뜨고 선택하면 입력이 비워진다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    await expect(section).toBeVisible();

    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("/검");

    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("웹 검색")).toBeVisible();
    await expect(popover.getByText("대화 지우기")).toHaveCount(0);

    await popover.getByText("웹 검색").click();
    await expect(popover).toBeHidden();
    await expect(textarea).toHaveValue("");

    await page.screenshot({
      path: "../../.ralph/screenshots/chat-input-slash-mention.png",
      fullPage: true,
    });
  });

  test("@ 입력 시 엔티티 픽커가 뜨고 선택하면 참조 토큰이 삽입된다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("@know");

    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();
    await expect(popover.getByText("knowledge_search")).toBeVisible();

    await popover.getByText("knowledge_search").click();
    await expect(popover).toBeHidden();
    await expect(textarea).toHaveValue("@knowledge_search ");
  });

  test("Escape 키로 팝오버를 닫으면 입력 텍스트는 유지된다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("/대");

    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();

    await textarea.press("Escape");
    await expect(popover).toBeHidden();
    await expect(textarea).toHaveValue("/대");
  });

  // P21-T6-07 — 데스크톱(≥md, 이 프로젝트 기본 Desktop Chrome 뷰포트) 바깥클릭 해제.
  // backdrop 이 md:hidden 이라 모바일에서만 동작하던 갭을 useDismiss 로 메운다.
  test("UX-01: 데스크톱 뷰포트에서 팝오버 밖 pointerdown 시 팝오버가 닫히고 입력 텍스트는 유지된다", async ({
    page,
  }) => {
    await page.goto("/preview");
    const section = page.getByTestId("preview-chat-input");
    const textarea = section.getByLabel("메시지 입력");
    await textarea.fill("/검");

    const popover = section.getByTestId("composer-popover");
    await expect(popover).toBeVisible();

    await page.mouse.click(10, 10);
    await expect(popover).toBeHidden();
    await expect(textarea).toHaveValue("/검");
  });
});

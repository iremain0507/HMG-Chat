import { test, expect } from "@playwright/test";

// e2e/chat-agentic.pw.ts — P13-T6-03 브라우저 검증(Layer 1).
//   /preview 의 chat-agentic 섹션을 실제 chromium 으로 열어 F04(에이전틱 라이브) 핸드오프대로
//   user primary-50 버블 + assistant 풀폭 문서형(버블 없음) + Run Rail(눈금 hover 툴팁·클릭
//   콜백)이 실제 렌더/상호작용으로 동작하는지 검증한다.

test.describe("P13 preview — 채팅(F04 히어로) 핸드오프 정렬", () => {
  test("user 버블·assistant 풀폭·Run Rail 눈금·hover 툴팁이 렌더된다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-chat-agentic");
    await expect(section).toBeVisible();

    const userBubble = section.locator(
      '[data-role="user"] div.whitespace-pre-wrap',
    );
    await expect(userBubble).toHaveClass(/bg-primary-50/);
    await expect(userBubble).toHaveClass(/rounded-\[10px\]/);

    // assistant 콘텐츠 컬럼(.min-w-0)은 풀폭 문서형(버블 없음) — bg-primary 배경의 "버블"이
    // 없어야 한다. (Run Rail 자체는 진행 중 눈금에 bg-primary 를 쓰므로 콘텐츠 컬럼 밖의
    // 형제 요소다. StatusChip 의 running 도트(P13-T6-06 공용 어휘)는 6px 점일 뿐 버블이
    // 아니므로 제외한다.)
    const assistantContent = section.locator(
      '[data-role="assistant"] .min-w-0',
    );
    await expect(
      assistantContent.locator(
        ".bg-primary:not([data-testid='status-chip-dot'])",
      ),
    ).toHaveCount(0);

    const rail = section.getByTestId("run-rail");
    await expect(rail).toBeVisible();
    await expect(
      section.getByTestId("run-rail-tick-preview-rail-1"),
    ).toHaveAttribute("data-status", "done");
    await expect(
      section.getByTestId("run-rail-tick-preview-rail-2"),
    ).toHaveAttribute("data-status", "running");

    const tooltip = section.getByTestId("run-rail-tooltip-preview-rail-2");
    await expect(tooltip).toHaveClass(/opacity-0/);
    await section.getByTestId("run-rail-tick-preview-rail-2").hover();
    await expect(tooltip).toHaveClass(/opacity-100/);

    await section.screenshot({
      path: "../../.ralph/screenshots/chat-agentic-light.png",
    });
  });

  test("다크 테마에서도 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");

    const section = page.getByTestId("preview-chat-agentic");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("run-rail")).toBeVisible();

    await section.screenshot({
      path: "../../.ralph/screenshots/chat-agentic-dark.png",
    });
  });
});

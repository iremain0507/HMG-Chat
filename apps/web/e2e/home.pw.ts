import { test, expect } from "@playwright/test";

// e2e/home.pw.ts — P13-T6-02 브라우저 검증(Layer 1).
//   /preview 의 home 섹션을 실제 chromium 으로 열어 인사·컴포저 트리거·빠른 시작 2x2·
//   능력 스트립·최근 세션 5(F03)가 design-reference 핸드오프대로 렌더되고 클릭 상호작용이
//   실제 DOM 이벤트로 동작하는지 검증한다.

test.describe("P13 preview — 홈(F03) 핸드오프 정렬", () => {
  test("인사·컴포저·빠른 시작·능력 스트립·최근 세션이 렌더되고 클릭 상호작용이 동작한다(라이트)", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-home");
    await expect(section).toBeVisible();
    await expect(section).toContainText("안녕하세요, 김민수님");

    const lastAction = section.getByTestId("home-last-action");
    await expect(lastAction).toContainText("(없음)");

    await section.getByText("새 채팅 시작").click();
    await expect(lastAction).toContainText("새 채팅 시작");

    await section.getByText("WIA 브랜드 PPT 만들기").click();
    await expect(lastAction).toContainText(
      "빠른 시작: WIA 브랜드 PPT 초안을 만들어줘",
    );

    await expect(section.getByTestId("capability-connectors")).toContainText(
      "6",
    );
    await expect(section.getByTestId("capability-agents")).toContainText("4");
    await expect(section.getByTestId("capability-skills")).toContainText("13");

    await expect(
      section.getByText("등속조인트 공정 불량 원인 분석"),
    ).toBeVisible();
    await section.getByText("협력사 RFQ 회신 초안").click();
    await expect(lastAction).toContainText("세션 열기: hs3");

    await section.screenshot({
      path: "../../.ralph/screenshots/home-light.png",
    });
  });

  test("다크 테마에서도 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await page.goto("/preview");

    const section = page.getByTestId("preview-home");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(section).toBeVisible();
    await expect(section).toContainText("안녕하세요, 김민수님");

    await section.screenshot({
      path: "../../.ralph/screenshots/home-dark.png",
    });
  });
});

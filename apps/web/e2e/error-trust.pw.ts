import { test, expect } from "@playwright/test";

// e2e/error-trust.pw.ts — P10-T6-17 브라우저 검증(Layer 1).
//   에러 배너(재시도 가능/불가능 구분) + 토스트 시스템 + 오프라인 배너가 실제 chromium 에서
//   렌더/인터랙션되는지 검증한다.
test.describe("P10 preview — 에러/신뢰(D4)", () => {
  test("retryable 오류만 재시도 버튼을 노출하고, rate-limit 오류는 백오프 안내를 함께 보여준다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-error-banner");
    await expect(section).toBeVisible();

    await expect(section.getByText("요청이 너무 많습니다")).toBeVisible();
    await expect(section.getByText("잠시 후 다시 시도해주세요.")).toBeVisible();
    await expect(section.getByRole("button", { name: "재시도" })).toBeVisible();

    await expect(section.getByText("크레딧이 부족합니다")).toBeVisible();
    // 두 번째 배너(비재시도)에는 재시도 버튼이 없어야 하므로, 전체 섹션 내 버튼이 1개뿐이어야 한다.
    await expect(section.getByRole("button", { name: "재시도" })).toHaveCount(
      1,
    );

    await page.screenshot({
      path: "../../.ralph/screenshots/error-banner.png",
      fullPage: true,
    });
  });

  test("토스트 버튼을 누르면 토스트가 나타나고 닫기 버튼으로 사라진다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-toast");
    await section.getByRole("button", { name: "에러 토스트" }).click();
    await expect(section.getByText("전송에 실패했습니다")).toBeVisible();

    await section.getByRole("button", { name: "토스트 닫기" }).click();
    await expect(section.getByText("전송에 실패했습니다")).toBeHidden();

    await page.screenshot({
      path: "../../.ralph/screenshots/toast.png",
      fullPage: true,
    });
  });

  test("오프라인으로 전환하면 배너가 나타나고, 온라인 복귀 시 사라진다", async ({
    page,
  }) => {
    await page.goto("/preview");

    const section = page.getByTestId("preview-offline-banner");
    await expect(section.getByTestId("offline-banner")).toBeHidden();

    await section.getByRole("button", { name: "오프라인으로 전환" }).click();
    await expect(section.getByTestId("offline-banner")).toBeVisible();

    await page.screenshot({
      path: "../../.ralph/screenshots/offline-banner.png",
      fullPage: true,
    });

    await section.getByRole("button", { name: "온라인으로 복귀" }).click();
    await expect(section.getByTestId("offline-banner")).toBeHidden();
  });
});

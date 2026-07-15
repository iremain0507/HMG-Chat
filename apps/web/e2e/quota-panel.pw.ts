import { test, expect } from "@playwright/test";

// e2e/quota-panel.pw.ts — P13-T6-12 브라우저 검증(Layer 1).
//   /preview 의 quota-panel 섹션(QuotaPanel, F14) 을 실제 chromium 으로 열어 예산/사용액
//   mono 헤드라인·80% 임계선 마커·최근 30일 라인차트가 design-reference 핸드오프대로
//   렌더되는지 검증한다. useQuota 의 fetch 는 page.route() 로 목킹한다.
const QUOTA = {
  budgetMicros: 300_000_000_000,
  usedMicros: 141_000_000_000,
  periodEnd: "2026-07-31T00:00:00Z",
};

const DAILY = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, "0")}`,
  tokensIn: 100 + i,
  tokensOut: 50 + i,
  costMicros: (7_000_000 + i * 300_000) as number,
}));

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/quota", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: QUOTA }),
    }),
  );
  await page.route("**/api/v1/usage/me*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: DAILY }),
    }),
  );
}

test.describe("P13 preview — 사용량/쿼터(F14) 핸드오프 정렬", () => {
  test("예산 헤드라인·80% 임계선·라인차트가 렌더된다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-quota-panel");
    await expect(section).toBeVisible();
    await section.getByTestId("quota-panel-preview-trigger").click();

    await expect(section.getByText("/settings/quota")).toBeVisible();
    await expect(section.getByTestId("quota-used-amount")).toHaveText(
      "₩141,000",
    );
    await expect(section.getByText(/₩300,000/)).toBeVisible();
    await expect(section.getByTestId("quota-threshold-marker")).toBeVisible();
    await expect(
      section.getByRole("img", { name: "최근 30일 일별 사용액 추이" }),
    ).toBeVisible();

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/quota-panel-light.png",
    });
  });

  test("다크 테마에서도 사용량 패널이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-quota-panel");
    await section.getByTestId("quota-panel-preview-trigger").click();

    await expect(section.getByTestId("quota-used-amount")).toHaveText(
      "₩141,000",
    );

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/quota-panel-dark.png",
    });
  });
});

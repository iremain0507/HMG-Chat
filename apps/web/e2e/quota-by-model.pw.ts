import { test, expect } from "@playwright/test";

// e2e/quota-by-model.pw.ts — P22-T6-19(A) 브라우저 검증(Layer 1).
//   /preview 의 quota-panel 섹션(QuotaPanel, F14) 을 실제 chromium 으로 열어, GET /usage/me 의
//   byModel(계약단위 C17(A)) 이 "모델별 비용" 표로 렌더되고 표의 합계가 이번 달 총액과
//   일치하는지 검증한다. useQuota 의 fetch 는 page.route() 로 목킹한다.
const QUOTA = {
  budgetMicros: 300_000_000_000,
  usedMicros: 141_000_000_000,
  periodEnd: "2026-07-31T00:00:00Z",
};

const DAILY = Array.from({ length: 10 }, (_, i) => ({
  date: `2026-07-${String(i + 1).padStart(2, "0")}`,
  tokensIn: 100 + i,
  tokensOut: 50 + i,
  costMicros: 7_000_000 + i * 300_000,
}));

// costMicros 내림차순(서버 정렬) · 합계 141_000_000_000 === QUOTA.usedMicros.
const BY_MODEL = [
  {
    model: "claude-opus-4-6",
    tokensIn: 1200,
    tokensOut: 600,
    costMicros: 120_000_000_000,
  },
  {
    model: "claude-haiku-4-6",
    tokensIn: 400,
    tokensOut: 200,
    costMicros: 21_000_000_000,
  },
];

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
      body: JSON.stringify({ data: DAILY, byModel: BY_MODEL }),
    }),
  );
}

test.describe("P22 preview — 사용량/쿼터 모델별 비용 breakdown", () => {
  test("byModel 이 모델별 비용 표로 렌더되고 합계가 월 총액과 일치한다", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const section = page.getByTestId("preview-quota-panel");
    await expect(section).toBeVisible();
    await section.getByTestId("quota-panel-preview-trigger").click();

    await expect(section.getByText("모델별 비용")).toBeVisible();

    const rows = section.getByTestId("quota-by-model-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("claude-opus-4-6");
    await expect(rows.nth(0)).toContainText("₩120,000");
    await expect(rows.nth(1)).toContainText("claude-haiku-4-6");
    await expect(rows.nth(1)).toContainText("₩21,000");

    // 수용 기준: 모델별 비용 합 === 이번 달 총액.
    await expect(section.getByTestId("quota-by-model-total")).toHaveText(
      "₩141,000",
    );
    await expect(section.getByTestId("quota-used-amount")).toHaveText(
      "₩141,000",
    );

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/quota-by-model-light.png",
    });
  });

  test("다크 테마에서도 모델별 비용 표가 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const section = page.getByTestId("preview-quota-panel");
    await section.getByTestId("quota-panel-preview-trigger").click();

    await expect(section.getByTestId("quota-by-model-row")).toHaveCount(2);
    await expect(section.getByTestId("quota-by-model-total")).toHaveText(
      "₩141,000",
    );

    await section.scrollIntoViewIfNeeded();
    await section.screenshot({
      path: "../../.ralph/screenshots/quota-by-model-dark.png",
    });
  });
});

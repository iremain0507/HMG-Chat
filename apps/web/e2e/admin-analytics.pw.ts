import { test, expect } from "@playwright/test";

// e2e/admin-analytics.pw.ts — P20-T1-15 브라우저 검증(Layer 1, ★needsBrowser).
//   /preview 의 admin-analytics 섹션을 실제 chromium 으로 열어 GET /api/v1/admin/analytics
//   응답이 모델별 사용량 테이블과 메시지 타임라인 차트로 실제 렌더되는지 검증한다. 실앱
//   dev-login E2E 하네스는 이 세션에 아직 없어(§2, P20-T6-04/06/08/11/T1-07 과 동일 사유)
//   /preview 갤러리 + route 목킹을 브라우저 레이어로 쓴다. 실제 DB 집계·admin 403·cross-org
//   격리·groupId 필터(서버측 실배선)는 createApp+실Postgres 통합테스트
//   (admin-analytics-composition.test.ts)가 담당한다 — 이 e2e 는 클라이언트가 실제 화면에서
//   서버 응답을 왜곡 없이 렌더하는 last-mile 만 검증한다.
test.describe("P20-T1-15 preview — 사용량 분석(Analytics) 대시보드", () => {
  test("모델별 사용량 테이블 + 메시지 타임라인 차트가 실제로 렌더된다", async ({
    page,
  }) => {
    await page.route("**/api/v1/admin/analytics*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            modelUsage: [
              {
                model: "gpt-4o",
                messages: 42,
                tokensIn: 1000,
                tokensOut: 500,
                costMicros: 12_000_000,
              },
              {
                model: "gpt-4o-mini",
                messages: 7,
                tokensIn: 200,
                tokensOut: 90,
                costMicros: 500_000,
              },
            ],
            timeline: [
              { bucket: "2026-07-01T00:00:00.000Z", count: 5 },
              { bucket: "2026-07-02T00:00:00.000Z", count: 9 },
            ],
          },
        }),
      });
    });

    await page.goto("/preview");

    const section = page.getByTestId("preview-admin-analytics");
    await section.getByTestId("analytics-dashboard-preview-trigger").click();

    await expect(section.getByText("gpt-4o", { exact: true })).toBeVisible();
    await expect(section.getByText("gpt-4o-mini")).toBeVisible();
    await expect(section.getByText("42")).toBeVisible();
    await expect(section.getByRole("img", { name: /타임라인/ })).toBeVisible();
  });
});

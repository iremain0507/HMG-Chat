import { test, expect } from "@playwright/test";

// e2e/admin-audit-logs.pw.ts — P20-T1-16 브라우저 검증(Layer 1, ★needsBrowser).
//   /preview 의 admin-audit-logs 섹션을 실제 chromium 으로 열어 GET /api/v1/admin/audit-logs
//   응답이 실제 테이블로 렌더되는지 검증한다. 실앱 dev-login E2E 하네스는 이 세션에 아직
//   없어(§2, P20-T1-15 등과 동일 사유) /preview 갤러리 + route 목킹을 브라우저 레이어로 쓴다.
//   실제 DB 기록·admin 403·cross-org 격리(서버측 실배선)는 createApp+실Postgres 통합테스트
//   (admin-audit-composition.test.ts)가 담당한다 — 이 e2e 는 클라이언트가 실제 화면에서
//   서버 응답을 왜곡 없이 렌더하는 last-mile 만 검증한다.
test.describe("P20-T1-16 preview — 감사 로그(Audit Log) 조회 테이블", () => {
  test("감사 로그 행이 실제로 렌더된다", async ({ page }) => {
    await page.route("**/api/v1/admin/audit-logs*", (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              id: "log-1",
              actorUserId: "user-1",
              action: "admin.settings.updated",
              resourceType: "org_settings",
              resourceId: "org-1",
              metadata: { maxTokens: 9000 },
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          meta: { requestId: "req-1" },
        }),
      });
    });

    await page.goto("/preview");

    const section = page.getByTestId("preview-admin-audit-logs");
    await section.getByTestId("audit-log-table-preview-trigger").click();

    await expect(section.getByText("admin.settings.updated")).toBeVisible();
    await expect(section.getByText("org_settings:org-1")).toBeVisible();
  });
});

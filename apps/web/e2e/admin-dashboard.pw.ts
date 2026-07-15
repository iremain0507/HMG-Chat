import { test, expect } from "@playwright/test";

// e2e/admin-dashboard.pw.ts — P13-T6-13 브라우저 검증(Layer 1).
//   /preview 의 admin-dashboard·tool-metrics-table·admin-users-manager 섹션(F15)을 실제
//   chromium 으로 열어 밀도 높은 카드·지표 테이블·사용자 관리 배지가 design-reference
//   핸드오프대로 렌더되는지 검증한다. 각 훅의 fetch 는 page.route() 로 목킹한다.
const DASHBOARD_SUMMARY = {
  users: { total: 214, activeLast24h: 37, newLast7d: 8 },
  sessions: { total: 120, activeNow: 37, completedLast24h: 30 },
  errors: { last24h: 12, last7d: 40, critical: 0 },
  tools: { totalCalls24h: 9787, errorRate: 0.012, p50LatencyMs: 240 },
};

const TOOL_METRICS = [
  {
    toolName: "knowledge_search",
    count: 4213,
    errorCount: 17,
    errorRate: 0.004,
    p50DurationMs: 240,
    p95DurationMs: 600,
    p99DurationMs: 900,
    last24h: { count: 400, errorRate: 0.003 },
  },
  {
    toolName: "code_interpreter",
    count: 486,
    errorCount: 15,
    errorRate: 0.031,
    p50DurationMs: 2140,
    p95DurationMs: 3200,
    p99DurationMs: 4100,
    last24h: { count: 40, errorRate: 0.03 },
  },
];

const USER_1 = {
  id: "user-1",
  email: "a@example.com",
  name: "사용자A",
  orgId: "org-1",
  role: "member" as const,
  status: "active" as const,
  lastLoginAt: "2026-07-01T00:00:00Z",
};

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/admin/dashboard", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: DASHBOARD_SUMMARY }),
    }),
  );
  await page.route("**/api/v1/admin/tool-metrics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: TOOL_METRICS }),
    }),
  );
  await page.route("**/api/v1/admin/users", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [USER_1] }),
    }),
  );
}

test.describe("P13 preview — 관리자(F15) 핸드오프 정렬", () => {
  test("대시보드 카드·지표 테이블·사용자 배지가 렌더된다(라이트)", async ({
    page,
  }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const dashboard = page.getByTestId("preview-admin-dashboard");
    await expect(dashboard).toBeVisible();
    await dashboard.getByTestId("admin-dashboard-preview-trigger").click();
    await expect(dashboard.getByText("/admin", { exact: true })).toBeVisible();
    await expect(dashboard.getByTestId("admin-stat-users")).toHaveText("214");
    await expect(dashboard.getByTestId("admin-stat-sessions")).toHaveText(
      "120",
    );
    await expect(dashboard.getByTestId("admin-stat-errors")).toHaveText("12");
    await dashboard.scrollIntoViewIfNeeded();
    await dashboard.screenshot({
      path: "../../.ralph/screenshots/admin-dashboard-light.png",
    });

    const toolMetrics = page.getByTestId("preview-tool-metrics-table");
    await expect(toolMetrics).toBeVisible();
    await toolMetrics.getByTestId("tool-metrics-table-preview-trigger").click();
    await expect(toolMetrics.getByText("knowledge_search")).toBeVisible();
    const alertCell = toolMetrics.getByText("3.1%");
    await expect(alertCell).toBeVisible();
    await expect(alertCell).toHaveClass(/text-accent/);
    await toolMetrics.scrollIntoViewIfNeeded();
    await toolMetrics.screenshot({
      path: "../../.ralph/screenshots/tool-metrics-table-light.png",
    });

    const usersManager = page.getByTestId("preview-admin-users-manager");
    await expect(usersManager).toBeVisible();
    await usersManager
      .getByTestId("admin-users-manager-preview-trigger")
      .click();
    await expect(usersManager.getByText("a@example.com")).toBeVisible();
    await expect(usersManager.getByText("active")).toBeVisible();
    await usersManager.scrollIntoViewIfNeeded();
    await usersManager.screenshot({
      path: "../../.ralph/screenshots/admin-users-manager-light.png",
    });
  });

  test("다크 테마에서도 관리자 화면이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const dashboard = page.getByTestId("preview-admin-dashboard");
    await dashboard.getByTestId("admin-dashboard-preview-trigger").click();
    await expect(dashboard.getByTestId("admin-stat-users")).toHaveText("214");
    await dashboard.scrollIntoViewIfNeeded();
    await dashboard.screenshot({
      path: "../../.ralph/screenshots/admin-dashboard-dark.png",
    });

    const toolMetrics = page.getByTestId("preview-tool-metrics-table");
    await toolMetrics.getByTestId("tool-metrics-table-preview-trigger").click();
    await expect(toolMetrics.getByText("knowledge_search")).toBeVisible();
    await toolMetrics.scrollIntoViewIfNeeded();
    await toolMetrics.screenshot({
      path: "../../.ralph/screenshots/tool-metrics-table-dark.png",
    });

    const usersManager = page.getByTestId("preview-admin-users-manager");
    await usersManager
      .getByTestId("admin-users-manager-preview-trigger")
      .click();
    await expect(usersManager.getByText("a@example.com")).toBeVisible();
    await usersManager.scrollIntoViewIfNeeded();
    await usersManager.screenshot({
      path: "../../.ralph/screenshots/admin-users-manager-dark.png",
    });
  });
});

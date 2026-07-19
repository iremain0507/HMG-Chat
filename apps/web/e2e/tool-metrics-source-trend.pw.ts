import { test, expect } from "@playwright/test";

// e2e/tool-metrics-source-trend.pw.ts — P22-T6-19(C17B) 브라우저 검증(Layer 1).
//   /preview 의 tool-metrics-table 섹션을 실제 chromium 으로 열어 계약 확장 필드
//   (source·trend)가 "출처" 컬럼과 7일 추이 스파크라인으로 렌더되는지 검증한다.
//   useToolMetrics 의 fetch 는 page.route() 로 목킹한다(admin-dashboard.pw.ts 와 동일 패턴).
const TOOL_METRICS = [
  {
    toolName: "mcp:jira:create_issue",
    count: 512,
    errorCount: 4,
    errorRate: 0.008,
    p50DurationMs: 310,
    p95DurationMs: 800,
    p99DurationMs: 1200,
    last24h: { count: 60, errorRate: 0.005 },
    source: "mcp",
    trend: [
      { date: "2026-07-12", count: 40, errorCount: 0 },
      { date: "2026-07-13", count: 88, errorCount: 1 },
      { date: "2026-07-14", count: 61, errorCount: 0 },
      { date: "2026-07-15", count: 104, errorCount: 2 },
      { date: "2026-07-16", count: 72, errorCount: 0 },
      { date: "2026-07-17", count: 95, errorCount: 1 },
      { date: "2026-07-18", count: 52, errorCount: 0 },
    ],
  },
  {
    // source/trend 가 없는 기존 행 — 0039 이전에 쌓인 데이터의 하위호환 경로.
    toolName: "knowledge_search",
    count: 4213,
    errorCount: 17,
    errorRate: 0.004,
    p50DurationMs: 240,
    p95DurationMs: 600,
    p99DurationMs: 900,
    last24h: { count: 400, errorRate: 0.003 },
  },
];

async function mockBackend(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/admin/tool-metrics", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: TOOL_METRICS }),
    }),
  );
}

test.describe("P22-T6-19 preview — 툴 지표 출처/7일 추이", () => {
  test("출처 컬럼과 스파크라인이 렌더된다(라이트)", async ({ page }) => {
    await mockBackend(page);
    await page.goto("/preview");

    const toolMetrics = page.getByTestId("preview-tool-metrics-table");
    await expect(toolMetrics).toBeVisible();
    await toolMetrics.getByTestId("tool-metrics-table-preview-trigger").click();

    await expect(toolMetrics.getByText("출처", { exact: true })).toBeVisible();
    await expect(
      toolMetrics.getByText("7일 추이", { exact: true }),
    ).toBeVisible();

    // source='mcp' 는 'MCP', source 미지정(기존 행)은 '내장'.
    await expect(
      toolMetrics.getByTestId("tool-metric-source-mcp:jira:create_issue"),
    ).toHaveText("MCP");
    await expect(
      toolMetrics.getByTestId("tool-metric-source-knowledge_search"),
    ).toHaveText("내장");

    // trend 가 있는 행만 접근 가능한 스파크라인(role=img)을 그린다.
    const sparkline = toolMetrics.getByRole("img", {
      name: "mcp:jira:create_issue 최근 7일 호출 추이",
    });
    await expect(sparkline).toBeVisible();
    await expect(sparkline.locator("polyline")).toHaveAttribute(
      "stroke",
      "var(--color-primary)",
    );
    await expect(
      toolMetrics.getByTestId("tool-metric-trend-knowledge_search"),
    ).toHaveText("—");

    await toolMetrics.scrollIntoViewIfNeeded();
    await toolMetrics.screenshot({
      path: "../../.ralph/screenshots/tool-metrics-source-trend-light.png",
    });
  });

  test("다크 테마에서도 출처/스파크라인이 정상 렌더된다", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("wchat-theme", "dark");
    });
    await mockBackend(page);
    await page.goto("/preview");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    const toolMetrics = page.getByTestId("preview-tool-metrics-table");
    await toolMetrics.getByTestId("tool-metrics-table-preview-trigger").click();
    await expect(
      toolMetrics.getByTestId("tool-metric-source-mcp:jira:create_issue"),
    ).toHaveText("MCP");
    await expect(
      toolMetrics.getByRole("img", {
        name: "mcp:jira:create_issue 최근 7일 호출 추이",
      }),
    ).toBeVisible();

    await toolMetrics.scrollIntoViewIfNeeded();
    await toolMetrics.screenshot({
      path: "../../.ralph/screenshots/tool-metrics-source-trend-dark.png",
    });
  });
});

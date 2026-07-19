// @vitest-environment jsdom
// components/admin/ToolMetricsTable.tsx — 18-FRONTEND-WIREFRAMES § /admin/tool-metrics
// 테이블(tool name/count/error rate/p50 latency).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/tool-metrics",
}));

import { ToolMetricsTable } from "../ToolMetricsTable";

const METRIC = {
  toolName: "web_search",
  count: 100,
  errorCount: 2,
  errorRate: 0.02,
  p50DurationMs: 300,
  p95DurationMs: 900,
  p99DurationMs: 1500,
  last24h: { count: 10, errorRate: 0 },
};

describe("ToolMetricsTable", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("도구별 통계 행을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [METRIC] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(screen.getByText("web_search")).toBeInTheDocument();
    });
    expect(screen.getByText("300")).toBeInTheDocument();
  });

  it("대시보드/사용자/설정으로 가는 서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [METRIC] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-sub-nav-settings")).toHaveAttribute(
      "href",
      "/admin/settings",
    );
  });

  // P22-T6-19(C17B) RED: 출처 컬럼·7일 추이 스파크라인이 아직 없다.
  it("출처 컬럼을 표시한다(mcp → MCP)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ ...METRIC, source: "mcp" }] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(screen.getByText("출처")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("tool-metric-source-web_search"),
    ).toHaveTextContent("MCP");
  });

  it("source 가 없는 기존 행은 '내장' 으로 표시한다(하위호환)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [METRIC] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(
        screen.getByTestId("tool-metric-source-web_search"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("tool-metric-source-web_search"),
    ).toHaveTextContent("내장");
  });

  it("7일 추이를 접근 가능한 스파크라인(polyline)으로 렌더한다", async () => {
    const trend = [
      { date: "2026-07-12", count: 1, errorCount: 0 },
      { date: "2026-07-13", count: 4, errorCount: 0 },
      { date: "2026-07-14", count: 2, errorCount: 1 },
      { date: "2026-07-15", count: 7, errorCount: 0 },
      { date: "2026-07-16", count: 3, errorCount: 0 },
      { date: "2026-07-17", count: 5, errorCount: 2 },
      { date: "2026-07-18", count: 6, errorCount: 0 },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ ...METRIC, trend }] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(screen.getByText("7일 추이")).toBeInTheDocument();
    });
    const chart = screen.getByRole("img", {
      name: "web_search 최근 7일 호출 추이",
    });
    expect(chart).toBeInTheDocument();
    const polyline = chart.querySelector("polyline");
    expect(polyline).not.toBeNull();
    expect(polyline?.getAttribute("points")?.split(" ")).toHaveLength(7);
    // 디자인 규칙: 하드코딩 hex 금지 — 시맨틱 토큰 var(--color-*) 만.
    expect(polyline?.getAttribute("stroke")).toBe("var(--color-primary)");
  });

  it("trend 가 없으면 스파크라인 대신 대시를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [METRIC] }),
      })),
    );

    render(<ToolMetricsTable />);

    await waitFor(() => {
      expect(
        screen.getByTestId("tool-metric-trend-web_search"),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("img", { name: /최근 7일 호출 추이/ }),
    ).toBeNull();
  });
});

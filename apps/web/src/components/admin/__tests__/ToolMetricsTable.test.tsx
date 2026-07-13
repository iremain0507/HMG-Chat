// @vitest-environment jsdom
// components/admin/ToolMetricsTable.tsx — 18-FRONTEND-WIREFRAMES § /admin/tool-metrics
// 테이블(tool name/count/error rate/p50 latency).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
});

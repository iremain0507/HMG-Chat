// @vitest-environment jsdom
// hooks/useToolMetrics.ts — 16-API-CONTRACT § 14 GET /admin/tool-metrics 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useToolMetrics } from "../useToolMetrics";

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

describe("useToolMetrics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("도구별 통계를 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [METRIC] }),
      })),
    );

    const { result } = renderHook(() => useToolMetrics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.metrics).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/tool-metrics",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("실패 시 에러 메시지를 노출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useToolMetrics());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("도구 통계를 불러오지 못했습니다.");
  });
});

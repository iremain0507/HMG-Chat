// @vitest-environment jsdom
// hooks/useAdminDashboard.ts — 16-API-CONTRACT § 14 GET /admin/dashboard 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAdminDashboard } from "../useAdminDashboard";

const SUMMARY = {
  users: { total: 42, activeLast24h: 10, newLast7d: 3 },
  sessions: { total: 120, activeNow: 5, completedLast24h: 30 },
  errors: { last24h: 2, last7d: 8, critical: 0 },
  tools: { totalCalls24h: 200, errorRate: 0.01, p50LatencyMs: 120 },
};

describe("useAdminDashboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("대시보드 요약을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: SUMMARY }) })),
    );

    const { result } = renderHook(() => useAdminDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary?.users.total).toBe(42);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/dashboard",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("실패 시 에러 메시지를 노출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useAdminDashboard());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("대시보드 정보를 불러오지 못했습니다.");
  });
});

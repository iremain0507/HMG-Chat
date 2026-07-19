// @vitest-environment jsdom
// components/admin/AnalyticsDashboard.tsx — P20-T1-15: 모델별 사용량 테이블 + 메시지
// 타임라인 차트. GET /api/v1/admin/analytics 소비, 시맨틱 토큰만 사용.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/analytics",
}));

import { AnalyticsDashboard } from "../AnalyticsDashboard";

const ANALYTICS = {
  modelUsage: [
    {
      model: "gpt-4o",
      messages: 42,
      tokensIn: 1000,
      tokensOut: 500,
      costMicros: 12000,
    },
  ],
  timeline: [
    { bucket: "2026-07-01T00:00:00.000Z", count: 5 },
    { bucket: "2026-07-02T00:00:00.000Z", count: 9 },
  ],
};

describe("AnalyticsDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("모델별 사용량 테이블 행을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ANALYTICS }),
      })),
    );

    render(<AnalyticsDashboard />);

    await waitFor(() => {
      expect(screen.getByText("gpt-4o")).toBeInTheDocument();
    });
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("메시지 타임라인 차트를 렌더한다(접근성 role=img)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ANALYTICS }),
      })),
    );

    render(<AnalyticsDashboard />);

    await waitFor(() => {
      expect(screen.getByRole("img", { name: /타임라인/ })).toBeInTheDocument();
    });
  });

  it("데이터가 비어있으면 무데이터 안내를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { modelUsage: [], timeline: [] } }),
      })),
    );

    render(<AnalyticsDashboard />);

    await waitFor(() => {
      expect(screen.getByText(/데이터가 없습니다/)).toBeInTheDocument();
    });
  });

  it("서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ANALYTICS }),
      })),
    );

    render(<AnalyticsDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
  });
});

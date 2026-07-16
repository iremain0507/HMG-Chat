// @vitest-environment jsdom
// components/admin/AdminDashboard.tsx — 18-FRONTEND-WIREFRAMES § /admin 카드 3개(users/sessions/errors).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

import { AdminDashboard } from "../AdminDashboard";

const SUMMARY = {
  users: { total: 42, activeLast24h: 10, newLast7d: 3 },
  sessions: { total: 120, activeNow: 5, completedLast24h: 30 },
  errors: { last24h: 2, last7d: 8, critical: 0 },
  tools: { totalCalls24h: 200, errorRate: 0.01, p50LatencyMs: 120 },
};

describe("AdminDashboard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("users/sessions/errors 카드를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: SUMMARY }) })),
    );

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeInTheDocument();
    });
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("사용자/도구 지표/설정 하위 페이지로 가는 서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: SUMMARY }) })),
    );

    render(<AdminDashboard />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-sub-nav-users")).toHaveAttribute(
      "href",
      "/admin/users",
    );
  });

  it("도구 요약 캡션이 /admin/tool-metrics 링크다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: SUMMARY }) })),
    );

    render(<AdminDashboard />);

    const link = await screen.findByRole("link", {
      name: "/admin/tool-metrics",
    });
    expect(link).toHaveAttribute("href", "/admin/tool-metrics");
  });
});

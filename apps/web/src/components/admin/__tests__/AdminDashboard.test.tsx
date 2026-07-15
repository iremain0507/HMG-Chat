// @vitest-environment jsdom
// components/admin/AdminDashboard.tsx — 18-FRONTEND-WIREFRAMES § /admin 카드 3개(users/sessions/errors).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
});

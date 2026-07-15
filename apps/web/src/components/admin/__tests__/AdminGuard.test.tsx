// @vitest-environment jsdom
// components/admin/AdminGuard.tsx — 18-FRONTEND-WIREFRAMES § /admin* "admin role 만" 접근 게이트.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AdminGuard } from "../AdminGuard";

describe("AdminGuard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("admin role 이면 children 을 렌더링한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { user: { id: "u1", role: "admin" }, org: null },
        }),
      })),
    );

    render(
      <AdminGuard>
        <p>관리자 전용 화면</p>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("관리자 전용 화면")).toBeInTheDocument();
    });
  });

  it("member role 이면 접근 거부 메시지를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: { user: { id: "u1", role: "member" }, org: null },
        }),
      })),
    );

    render(
      <AdminGuard>
        <p>관리자 전용 화면</p>
      </AdminGuard>,
    );

    await waitFor(() => {
      expect(screen.getByText("접근 권한이 없습니다.")).toBeInTheDocument();
    });
    expect(screen.queryByText("관리자 전용 화면")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
// components/admin/AdminUsersManager.tsx — 18-FRONTEND-WIREFRAMES § /admin/users
// 테이블 + role 변경 dropdown + suspend 토글.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/users",
}));

import { AdminUsersManager } from "../AdminUsersManager";

const USER_1 = {
  id: "user-1",
  email: "a@example.com",
  name: "사용자A",
  orgId: "org-1",
  role: "member" as const,
  status: "active" as const,
  lastLoginAt: "2026-07-01T00:00:00Z",
};

describe("AdminUsersManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("사용자 목록을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [USER_1] }) })),
    );

    render(<AdminUsersManager />);

    await waitFor(() => {
      expect(screen.getByText("a@example.com")).toBeInTheDocument();
    });
  });

  it("role dropdown 변경 시 PATCH 요청을 보낸다", async () => {
    const updated = { ...USER_1, role: "admin" as const };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: true, json: async () => ({ data: updated }) };
        }
        return { ok: true, json: async () => ({ data: [updated] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("a@example.com")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("역할 (a@example.com)"), {
      target: { value: "admin" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/users/user-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ role: "admin" }),
        }),
      );
    });
  });

  it("정지 버튼으로 suspend 요청을 보낸다", async () => {
    const suspended = { ...USER_1, status: "suspended" as const };
    let suspendCalled = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/suspend")) {
          suspendCalled = true;
          return {
            ok: true,
            json: async () => ({ data: { ok: true, sessionsRevoked: 1 } }),
          };
        }
        void init;
        return {
          ok: true,
          json: async () => ({ data: [suspendCalled ? suspended : USER_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "prompt",
      vi.fn(() => "정책 위반"),
    );

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("a@example.com")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("정지 (a@example.com)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/users/user-1/suspend",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reason: "정책 위반" }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("suspended")).toBeInTheDocument();
    });
  });

  it("대시보드/도구 지표/설정으로 가는 서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [USER_1] }) })),
    );

    render(<AdminUsersManager />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
    expect(screen.getByTestId("admin-sub-nav-dashboard")).toHaveAttribute(
      "href",
      "/admin",
    );
  });
});

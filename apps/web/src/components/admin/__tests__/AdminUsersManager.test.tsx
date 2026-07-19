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
  createdAt: "2026-01-01T00:00:00Z",
};

const CURRENT_ADMIN = {
  id: "admin-self",
  email: "admin-self@example.com",
  name: "관리자",
  orgId: "org-1",
  role: "admin" as const,
  customInstructions: null,
  createdAt: "2025-01-01T00:00:00Z",
};

function stubAuthMeAnd(fetchImpl: typeof fetch): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/v1/auth/me")) {
      return {
        ok: true,
        json: async () => ({ data: { user: CURRENT_ADMIN, org: null } }),
      } as Response;
    }
    return fetchImpl(input, init);
  }) as unknown as typeof fetch;
}

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

  it("삭제 버튼 클릭 시 확인 후 DELETE 요청을 보내고 목록에서 제거된다", async () => {
    let deleteCalled = false;
    const fetchMock = stubAuthMeAnd((async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      if (init?.method === "DELETE") {
        deleteCalled = true;
        return {
          ok: true,
          json: async () => ({ data: { ok: true } }),
        } as Response;
      }
      void input;
      return {
        ok: true,
        json: async () => ({ data: deleteCalled ? [] : [USER_1] }),
      } as Response;
    }) as unknown as typeof fetch);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("a@example.com")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("삭제 (a@example.com)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/users/user-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("a@example.com")).not.toBeInTheDocument();
    });
  });

  it("org 최고령 owner(primary admin) 는 삭제 버튼이 비활성화되고 사유가 표시된다", async () => {
    const ownerA = {
      ...USER_1,
      id: "owner-a",
      email: "ownerA@example.com",
      role: "owner" as const,
      createdAt: "2025-06-01T00:00:00Z",
    };
    const ownerB = {
      ...USER_1,
      id: "owner-b",
      email: "ownerB@example.com",
      role: "owner" as const,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const fetchMock = stubAuthMeAnd((async () => ({
      ok: true,
      json: async () => ({ data: [ownerA, ownerB] }),
    })) as unknown as typeof fetch);
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("ownerA@example.com")).toBeInTheDocument();
    });

    const deleteButton = screen.getByLabelText("삭제 (ownerA@example.com)");
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute(
      "title",
      "최고 관리자(primary admin)는 삭제할 수 없습니다.",
    );
    expect(
      screen.getByLabelText("삭제 (ownerB@example.com)"),
    ).not.toBeDisabled();
  });

  it("조직에 owner 가 하나뿐이면 삭제 버튼이 비활성화된다", async () => {
    const soleOwner = {
      ...USER_1,
      id: "owner-sole",
      email: "sole-owner@example.com",
      role: "owner" as const,
    };
    const fetchMock = stubAuthMeAnd((async () => ({
      ok: true,
      json: async () => ({ data: [soleOwner] }),
    })) as unknown as typeof fetch);
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("sole-owner@example.com")).toBeInTheDocument();
    });

    const deleteButton = screen.getByLabelText("삭제 (sole-owner@example.com)");
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute(
      "title",
      "조직의 마지막 owner 는 삭제할 수 없습니다.",
    );
  });

  it("자기 자신은 삭제 버튼이 비활성화된다", async () => {
    const self = {
      ...USER_1,
      id: CURRENT_ADMIN.id,
      email: CURRENT_ADMIN.email,
    };
    const fetchMock = stubAuthMeAnd((async () => ({
      ok: true,
      json: async () => ({ data: [self] }),
    })) as unknown as typeof fetch);
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText(CURRENT_ADMIN.email)).toBeInTheDocument();
    });

    const deleteButton = screen.getByLabelText(`삭제 (${CURRENT_ADMIN.email})`);
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute(
      "title",
      "자기 자신은 삭제할 수 없습니다.",
    );
  });

  it("정지 버튼 연속 클릭 시 요청이 한 번만 발생하고 처리 중에는 정지 버튼과 역할 select 가 비활성화된다", async () => {
    let resolveSuspend: (() => void) | undefined;
    let suspendCallCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/suspend") && init?.method === "POST") {
          suspendCallCount += 1;
          await new Promise<void>((res) => {
            resolveSuspend = res;
          });
          return {
            ok: true,
            json: async () => ({ data: { ok: true, sessionsRevoked: 1 } }),
          };
        }
        return { ok: true, json: async () => ({ data: [USER_1] }) };
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

    const suspendButton = screen.getByLabelText("정지 (a@example.com)");
    const roleSelect = screen.getByLabelText("역할 (a@example.com)");

    fireEvent.click(suspendButton);

    await waitFor(() => {
      expect(suspendButton).toBeDisabled();
    });
    expect(roleSelect).toBeDisabled();

    // 처리 중 재클릭 — 이미 pending 이므로 no-op 이어야 한다.
    fireEvent.click(suspendButton);

    expect(suspendCallCount).toBe(1);

    resolveSuspend?.();

    await waitFor(() => {
      expect(suspendButton).not.toBeDisabled();
    });
    expect(roleSelect).not.toBeDisabled();
  });

  it("역할 변경 처리 중에는 select 와 정지 버튼이 비활성화되고 PATCH 요청이 한 번만 발생한다", async () => {
    let resolvePatch: (() => void) | undefined;
    let patchCallCount = 0;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          patchCallCount += 1;
          await new Promise<void>((res) => {
            resolvePatch = res;
          });
          return {
            ok: true,
            json: async () => ({ data: { ...USER_1, role: "admin" } }),
          };
        }
        return { ok: true, json: async () => ({ data: [USER_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AdminUsersManager />);
    await waitFor(() => {
      expect(screen.getByText("a@example.com")).toBeInTheDocument();
    });

    const roleSelect = screen.getByLabelText(
      "역할 (a@example.com)",
    ) as HTMLSelectElement;
    const suspendButton = screen.getByLabelText("정지 (a@example.com)");

    fireEvent.change(roleSelect, { target: { value: "admin" } });

    await waitFor(() => {
      expect(roleSelect).toBeDisabled();
    });
    expect(suspendButton).toBeDisabled();

    // 처리 중 재변경 — 이미 pending 이므로 두 번째 PATCH 는 발생하지 않아야 한다.
    fireEvent.change(roleSelect, { target: { value: "owner" } });

    expect(patchCallCount).toBe(1);

    resolvePatch?.();

    await waitFor(() => {
      expect(roleSelect).not.toBeDisabled();
    });
    expect(suspendButton).not.toBeDisabled();
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

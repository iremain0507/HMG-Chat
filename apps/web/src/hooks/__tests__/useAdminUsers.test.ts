// @vitest-environment jsdom
// hooks/useAdminUsers.ts — 16-API-CONTRACT § 14 GET/PATCH /admin/users, POST /admin/users/:id/suspend|unsuspend.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAdminUsers } from "../useAdminUsers";

const USER_1 = {
  id: "user-1",
  email: "a@example.com",
  name: "A",
  orgId: "org-1",
  role: "member" as const,
  status: "active" as const,
  lastLoginAt: "2026-07-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("useAdminUsers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("사용자 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [USER_1] }),
      })),
    );

    const { result } = renderHook(() => useAdminUsers());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.users).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/users",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("changeRole 은 PATCH 후 목록을 재조회한다", async () => {
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

    const { result } = renderHook(() => useAdminUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.changeRole("user-1", "admin");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/user-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
      }),
    );
    expect(result.current.users[0]?.role).toBe("admin");
  });

  it("suspend 는 POST /suspend 후 목록을 재조회한다", async () => {
    const suspended = { ...USER_1, status: "suspended" as const };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/suspend")) {
          return {
            ok: true,
            json: async () => ({ data: { ok: true, sessionsRevoked: 1 } }),
          };
        }
        void init;
        return { ok: true, json: async () => ({ data: [suspended] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.suspend("user-1", "정책 위반");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/user-1/suspend",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ reason: "정책 위반" }),
      }),
    );
    expect(result.current.users[0]?.status).toBe("suspended");
  });

  it("unsuspend 는 POST /unsuspend 후 목록을 재조회한다", async () => {
    const active = { ...USER_1, status: "active" as const };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/unsuspend")) {
          return { ok: true, json: async () => ({ data: { ok: true } }) };
        }
        void init;
        return { ok: true, json: async () => ({ data: [active] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.unsuspend("user-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/user-1/unsuspend",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.current.users[0]?.status).toBe("active");
  });

  it("deleteUser 는 DELETE 후 목록을 재조회한다", async () => {
    let deleteCalled = false;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          deleteCalled = true;
          return { ok: true, json: async () => ({ data: { ok: true } }) };
        }
        void input;
        return {
          ok: true,
          json: async () => ({ data: deleteCalled ? [] : [USER_1] }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.users).toHaveLength(1);

    let outcome: { ok: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.deleteUser("user-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/users/user-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(outcome?.ok).toBe(true);
    expect(result.current.users).toHaveLength(0);
  });

  it("deleteUser 실패 시 서버 에러 메시지를 표시하고 목록을 유지한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return {
            ok: false,
            json: async () => ({
              error: {
                message: "최고 관리자(primary admin)는 삭제할 수 없습니다.",
              },
            }),
          };
        }
        return { ok: true, json: async () => ({ data: [USER_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAdminUsers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      outcome = await result.current.deleteUser("user-1");
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome?.message).toBe(
      "최고 관리자(primary admin)는 삭제할 수 없습니다.",
    );
    expect(result.current.error).toBe(
      "최고 관리자(primary admin)는 삭제할 수 없습니다.",
    );
    expect(result.current.users).toHaveLength(1);
  });
});

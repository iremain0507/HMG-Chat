// @vitest-environment jsdom
// hooks/useCurrentUser.ts — 16-API-CONTRACT § AuthMeResponse 소비 (admin 게이트용 role 확인).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCurrentUser } from "../useCurrentUser";

const USER = {
  id: "user-1",
  email: "admin@example.com",
  name: "관리자",
  orgId: "org-1",
  role: "admin" as const,
  customInstructions: null,
  createdAt: "2026-07-01T00:00:00Z",
};

describe("useCurrentUser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("본인 정보를 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { user: USER, org: null } }),
      })),
    );

    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.role).toBe("admin");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("실패 시 user 를 null 로 유지한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useCurrentUser());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });
});

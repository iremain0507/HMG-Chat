// @vitest-environment jsdom
// hooks/useGroups.ts — /api/v1/admin/groups(P19-T1-13) CRUD + 멤버 추가/제거 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useGroups } from "../useGroups";

const GROUP_1 = {
  id: "group-1",
  name: "엔지니어링",
  memberUserIds: ["user-1"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("useGroups", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("그룹 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [GROUP_1] }),
      })),
    );

    const { result } = renderHook(() => useGroups());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/groups",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("createGroup 은 POST 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" && !String(_input).includes("/members")) {
          return { ok: true, json: async () => ({ data: GROUP_1 }) };
        }
        return { ok: true, json: async () => ({ data: [GROUP_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createGroup("엔지니어링");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/groups",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "엔지니어링" }),
      }),
    );
    expect(result.current.groups[0]?.name).toBe("엔지니어링");
  });

  it("renameGroup 은 PUT 요청을 보낸다", async () => {
    const renamed = { ...GROUP_1, name: "새이름" };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PUT") {
          return { ok: true, json: async () => ({ data: renamed }) };
        }
        return { ok: true, json: async () => ({ data: [renamed] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.renameGroup("group-1", "새이름");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/groups/group-1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "새이름" }),
      }),
    );
    expect(result.current.groups[0]?.name).toBe("새이름");
  });

  it("removeGroup 은 DELETE 요청을 보낸다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeGroup("group-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/groups/group-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("addMember/removeMember 는 각각 멤버 경로로 요청 후 재조회한다", async () => {
    const withMember = { ...GROUP_1, memberUserIds: ["user-1", "user-2"] };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" && String(input).endsWith("/members")) {
          return { ok: true, json: async () => ({}) };
        }
        if (init?.method === "DELETE" && String(input).includes("/members/")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [withMember] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useGroups());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addMember("group-1", "user-2");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/groups/group-1/members",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ userId: "user-2" }),
      }),
    );

    await act(async () => {
      await result.current.removeMember("group-1", "user-2");
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/admin/groups/group-1/members/user-2",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

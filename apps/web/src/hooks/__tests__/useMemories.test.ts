// @vitest-environment jsdom
// hooks/useMemories.ts — 16-API-CONTRACT § 9 Memories 소비 (CRUD + pin).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMemories } from "../useMemories";

const MEMORY_1 = {
  id: "mem-1",
  userId: "user-1",
  category: "user" as const,
  content: "나는 영업본부 소속",
  source: "auto-extract" as const,
  sessionId: null,
  pinned: true,
  metadata: null,
  createdAt: "2026-04-05T00:00:00Z",
  updatedAt: "2026-04-05T00:00:00Z",
};

describe("useMemories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("메모리 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [MEMORY_1] }),
      })),
    );

    const { result } = renderHook(() => useMemories());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.memories).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/memories",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("category 가 주어지면 쿼리에 반영한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );

    renderHook(() => useMemories("feedback"));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/memories?category=feedback",
        expect.objectContaining({ credentials: "include" }),
      );
    });
  });

  it("create 는 POST 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, json: async () => ({ data: MEMORY_1 }) };
        }
        return { ok: true, json: async () => ({ data: [MEMORY_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ category: "user", content: "새 메모리" });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/memories",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ category: "user", content: "새 메모리" }),
      }),
    );
    expect(result.current.memories).toHaveLength(1);
  });

  it("update 는 PATCH 로 pinned 를 토글한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({ data: { ...MEMORY_1, pinned: false } }),
          };
        }
        return { ok: true, json: async () => ({ data: [MEMORY_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update("mem-1", { pinned: false });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/memories/mem-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ pinned: false }),
      }),
    );
  });

  it("remove 는 DELETE 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMemories());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("mem-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/memories/mem-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.current.memories).toHaveLength(0);
  });
});

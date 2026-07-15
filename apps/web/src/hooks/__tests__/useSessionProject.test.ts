// @vitest-environment jsdom
// hooks/useSessionProject.ts — 16-API-CONTRACT § GET/PATCH /sessions/:id (projectId 스코핑) 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSessionProject } from "../useSessionProject";

describe("useSessionProject", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("세션의 projectId 를 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            id: "session-1",
            title: null,
            projectId: "proj-1",
            createdAt: "2026-04-01T00:00:00Z",
            archivedAt: null,
          },
        }),
      })),
    );

    const { result } = renderHook(() => useSessionProject("session-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.projectId).toBe("proj-1");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("setProject 로 세션의 projectId 를 PATCH 하고 상태를 갱신한다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            data: { id: "session-1", projectId: "proj-2" },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          data: { id: "session-1", projectId: null, createdAt: "x" },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionProject("session-1"));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.projectId).toBeNull();

    await act(async () => {
      await result.current.setProject("proj-2");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ projectId: "proj-2" }),
      }),
    );
    expect(result.current.projectId).toBe("proj-2");
  });
});

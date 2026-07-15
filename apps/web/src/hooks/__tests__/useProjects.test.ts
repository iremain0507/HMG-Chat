// @vitest-environment jsdom
// hooks/useProjects.ts — 16-API-CONTRACT § GET /projects?cursor&limit&visibility 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProjects } from "../useProjects";

describe("useProjects", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("접근 가능한 프로젝트 목록(visibility 매트릭스로 필터된)을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "proj-1",
              name: "영업 RFP 분석",
              description: null,
              visibility: "private",
              orgUnitId: null,
              ownerId: "user-1",
              createdAt: "2026-04-01T00:00:00Z",
            },
            {
              id: "proj-2",
              name: "사내 정책",
              description: null,
              visibility: "org",
              orgUnitId: null,
              ownerId: "user-2",
              createdAt: "2026-04-02T00:00:00Z",
            },
          ],
        }),
      })),
    );

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.projects).toHaveLength(2);
    expect(result.current.projects[0]?.name).toBe("영업 RFP 분석");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/projects",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("응답이 실패하면 error 메시지를 채운다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useProjects());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.projects).toHaveLength(0);
  });
});

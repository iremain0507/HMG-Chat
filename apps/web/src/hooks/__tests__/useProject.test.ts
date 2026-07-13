// @vitest-environment jsdom
// hooks/useProject.ts — 16-API-CONTRACT § GET /projects/:id 소비.
// existence leak 방지: private cross-org 든 team cross-org 든 서버는 동일하게 404 를
// 반환하고(P3-T1-02 § 0015 RLS), 훅은 이 둘을 구분하지 않고 동일한 notFound 상태로 노출한다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProject } from "../useProject";

describe("useProject", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("프로젝트를 정상 조회하면 project 를 채우고 notFound 는 false 다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "proj-1",
            name: "영업 RFP 분석",
            description: null,
            visibility: "private",
            orgUnitId: null,
            ownerId: "user-1",
            createdAt: "2026-04-01T00:00:00Z",
          },
        }),
      })),
    );

    const { result } = renderHook(() => useProject("proj-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(false);
    expect(result.current.project?.name).toBe("영업 RFP 분석");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/projects/proj-1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("다른 org 의 private 프로젝트를 조회하면(서버 404) notFound 가 true 다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useProject("other-org-private"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(true);
    expect(result.current.project).toBeNull();
  });

  it("visibility=team 인 프로젝트를 다른 org 에서 조회해도(서버 404) notFound 가 true 다 — private 케이스와 동일하게 구분 불가능해야 existence leak 이 없다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useProject("other-org-team"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(true);
  });
});

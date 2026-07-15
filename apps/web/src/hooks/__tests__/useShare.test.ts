// @vitest-environment jsdom
// hooks/useShare.ts — 16-API-CONTRACT § 8 GET /api/v1/share/:token 소비.
// 익명 접근이므로 credentials 미첨부. 존재하지 않는 토큰은 notFound, 만료/revoke 는 gone.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useShare } from "../useShare";

describe("useShare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("정상 토큰 조회 시 credentials 없이 요청하고 share 메타데이터를 채운다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            token: "tok-1",
            artifactId: "art-1",
            filename: "note.md",
            type: "markdown",
            sizeBytes: 5,
            mimeType: "text/markdown",
            expiresAt: "2026-08-01T00:00:00Z",
            viewCount: 0,
            revokedAt: null,
          },
        }),
      })),
    );

    const { result } = renderHook(() => useShare("tok-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(false);
    expect(result.current.gone).toBe(false);
    expect(result.current.share?.filename).toBe("note.md");
    expect(fetch).toHaveBeenCalledWith("/api/v1/share/tok-1");
  });

  it("존재하지 않는 토큰(404) 조회 시 notFound 가 true 다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useShare("missing"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(true);
    expect(result.current.gone).toBe(false);
    expect(result.current.share).toBeNull();
  });

  it("만료/revoke 된 토큰(410) 조회 시 gone 이 true 다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 410, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useShare("expired"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.gone).toBe(true);
    expect(result.current.notFound).toBe(false);
    expect(result.current.share).toBeNull();
  });
});

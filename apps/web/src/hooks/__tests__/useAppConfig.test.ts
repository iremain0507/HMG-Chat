// @vitest-environment jsdom
// hooks/useAppConfig.ts — P19-T6-15: GET /api/v1/config 의 typed 배너(P19-T1-10/T1-15 소비).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppConfig } from "../useAppConfig";

describe("useAppConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET /api/v1/config 의 banner 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            availableModels: [],
            availableTools: [],
            features: {},
            banner: [
              { type: "warning", content: "점검 예정", dismissible: true },
            ],
          },
        }),
      })),
    );

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() =>
      expect(result.current.banner).toEqual([
        { type: "warning", content: "점검 예정", dismissible: true },
      ]),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/config",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("응답에 banner 가 없거나 실패하면 빈 배열로 fail-soft 한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.banner).toEqual([]);
  });

  it("네트워크 예외 시에도 조용히 실패하지 않고 빈 배열을 유지한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );

    const { result } = renderHook(() => useAppConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.banner).toEqual([]);
  });
});

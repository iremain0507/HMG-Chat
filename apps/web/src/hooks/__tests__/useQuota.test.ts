// @vitest-environment jsdom
// hooks/useQuota.ts — design-reference F14(사용량/쿼터) 소비. 16-API-CONTRACT § 12
// GET /quota + GET /usage/me(기존, P9 에서 이미 마운트) 를 그대로 사용 — 신규 라우트 없음.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useQuota } from "../useQuota";

const QUOTA = {
  budgetMicros: 300_000_000_000,
  usedMicros: 142_300_000_000,
  periodEnd: "2026-07-31T00:00:00Z",
};

const DAILY = [
  { date: "2026-07-14", tokensIn: 100, tokensOut: 50, costMicros: 8_000_000 },
  { date: "2026-07-15", tokensIn: 120, tokensOut: 60, costMicros: 8_200_000 },
];

describe("useQuota", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("quota 와 최근 30일 일별 사용량을 로드한다", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/v1/quota")) {
        return { ok: true, json: async () => ({ data: QUOTA }) };
      }
      return { ok: true, json: async () => ({ data: DAILY }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useQuota());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.quota).toEqual(QUOTA);
    expect(result.current.daily).toEqual(DAILY);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/quota",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/usage/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("quota 조회 실패 시 에러 메시지를 노출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/quota")) {
          return { ok: false, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      }),
    );

    const { result } = renderHook(() => useQuota());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe("사용량 정보를 불러오지 못했습니다.");
    expect(result.current.quota).toBeNull();
  });
});

// @vitest-environment jsdom
// hooks/useSkills.ts — 16-API-CONTRACT § 11 Skills 소비 (GET /skills 목록).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useSkills } from "../useSkills";

const SKILL_1 = {
  id: "wchat-pptx@1.0.0",
  name: "wchat-pptx",
  version: "1.0.0",
  description: "브랜드 PPTX 생성 스킬입니다.",
  triggers: ["ppt", "발표자료"],
  entryPoint: "skills/wchat-pptx/scripts/build.py",
  permissions: "user" as const,
};

describe("useSkills", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("스킬 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [SKILL_1] }),
      })),
    );

    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.skills).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/skills",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("응답 실패 시 에러를 노출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useSkills());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.skills).toHaveLength(0);
  });
});

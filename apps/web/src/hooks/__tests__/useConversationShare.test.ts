// @vitest-environment jsdom
// hooks/useConversationShare.ts — P20-T1-08 GET /api/v1/conversation-shares/:token 소비.
// 익명 접근이므로 credentials 미첨부. 존재하지 않는 토큰은 notFound, 만료/revoke 는 gone.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useConversationShare } from "../useConversationShare";

describe("useConversationShare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("정상 토큰 조회 시 credentials 없이 요청하고 스냅샷 메타데이터를 채운다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            token: "tok-1",
            sessionId: "session-1",
            title: "테스트 대화",
            capturedAt: "2026-07-17T00:00:00.000Z",
            messages: [
              {
                id: "m1",
                role: "user",
                content: "안녕",
                createdAt: "2026-07-17T00:00:00.000Z",
              },
            ],
            revokedAt: null,
          },
        }),
      })),
    );

    const { result } = renderHook(() => useConversationShare("tok-1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.notFound).toBe(false);
    expect(result.current.gone).toBe(false);
    expect(result.current.share?.title).toBe("테스트 대화");
    expect(result.current.share?.messages).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/v1/conversation-shares/tok-1");
  });

  it("존재하지 않는 토큰(404) 조회 시 notFound 가 true 다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useConversationShare("missing"));

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

    const { result } = renderHook(() => useConversationShare("expired"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.gone).toBe(true);
    expect(result.current.notFound).toBe(false);
    expect(result.current.share).toBeNull();
  });

  it("기타 오류 응답 시 error 메시지를 채운다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "서버 오류" } }),
      })),
    );

    const { result } = renderHook(() => useConversationShare("boom"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe("서버 오류");
  });
});

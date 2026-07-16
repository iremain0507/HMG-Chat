// @vitest-environment jsdom
// hooks/useSessions.ts — 16-API-CONTRACT § GET/POST/PATCH/DELETE /sessions 소비.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useSessions } from "../useSessions";

describe("useSessions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("세션 목록을 GET /sessions 로 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "sess-1",
              title: "영업 RFP 초안",
              lastMessageAt: "2026-07-14T01:00:00Z",
              projectId: null,
              archived: false,
            },
          ],
        }),
      })),
    );

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]?.title).toBe("영업 RFP 초안");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("응답 실패 시 error 메시지를 채운다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );

    const { result } = renderHook(() => useSessions());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.sessions).toHaveLength(0);
  });

  it("createSession 이 POST /sessions 를 호출하고 생성된 세션을 반환한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "POST" && url === "/api/v1/sessions") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "sess-new",
                title: null,
                projectId: null,
                createdAt: "2026-07-14T02:00:00Z",
              },
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      const created = await result.current.createSession();
      expect(created).not.toBeNull();
      expect(created?.id).toBe("sess-new");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("renameSession 이 PATCH /sessions/:id 를 title 과 함께 호출한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          return { ok: true, status: 200, json: async () => ({ data: {} }) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-1",
                title: "old",
                lastMessageAt: "2026-07-14T01:00:00Z",
                projectId: null,
                archived: false,
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.renameSession("sess-1", "new title");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/sess-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "new title" }),
      }),
    );
    expect(result.current.sessions[0]?.title).toBe("new title");
  });

  it("togglePin 이 PATCH /sessions/:id/pin 을 호출하고 서버 pinned 값을 반영한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/sessions/sess-1/pin" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: "sess-1", pinned: true } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-1",
                title: "세션 A",
                lastMessageAt: "2026-07-14T01:00:00Z",
                projectId: null,
                archived: false,
                pinned: false,
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sessions[0]?.pinned).toBe(false);

    await act(async () => {
      await result.current.togglePin("sess-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/sess-1/pin",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(result.current.sessions[0]?.pinned).toBe(true);
  });

  it("togglePin 요청 실패 시 낙관적 업데이트를 롤백한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/sessions/sess-1/pin" && init?.method === "PATCH") {
          return { ok: false, status: 500, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-1",
                title: "세션 A",
                lastMessageAt: "2026-07-14T01:00:00Z",
                projectId: null,
                archived: false,
                pinned: false,
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessions());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.togglePin("sess-1");
    });

    expect(result.current.sessions[0]?.pinned).toBe(false);
  });
});

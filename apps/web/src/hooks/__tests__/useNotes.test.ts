// @vitest-environment jsdom
// hooks/useNotes.ts — P22-T6-17 노트 워크스페이스 소비.
//   GET/POST/PATCH/DELETE /api/v1/notes + POST /api/v1/notes/:id/enhance 계약을 따른다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useNotes } from "../useNotes";

const NOTE_1 = {
  id: "note-1",
  orgId: "org-1",
  userId: "user-1",
  title: "설비 점검 메모",
  content: "# 점검\n\n- 항목 1",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

describe("useNotes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("노트 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [NOTE_1] }) })),
    );

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]?.title).toBe("설비 점검 메모");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/notes",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("create — POST 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, json: async () => ({ data: NOTE_1 }) }
        : { ok: true, json: async () => ({ data: [NOTE_1] }) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ title: "새 노트" });
    });

    const post = fetchMock.mock.calls.find(
      ([, init]) =>
        (init as { method?: string } | undefined)?.method === "POST",
    );
    expect(post?.[0]).toBe("/api/v1/notes");
    // 변이 후 재조회(GET)가 한 번 더 일어나 서버 상태를 단일 출처로 유지한다.
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === "/api/v1/notes" &&
          (init as { method?: string } | undefined)?.method === undefined,
      ),
    ).toHaveLength(2);
  });

  it("update — PATCH /:id 로 본문을 저장한다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "PATCH"
        ? { ok: true, json: async () => ({ data: NOTE_1 }) }
        : { ok: true, json: async () => ({ data: [NOTE_1] }) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.update("note-1", { content: "새 본문" });
    });

    const patch = fetchMock.mock.calls.find(
      ([, init]) =>
        (init as { method?: string } | undefined)?.method === "PATCH",
    );
    expect(patch?.[0]).toBe("/api/v1/notes/note-1");
    expect((patch?.[1] as { body: string }).body).toContain("새 본문");
  });

  it("remove — DELETE /:id 를 호출한다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "DELETE"
        ? { ok: true, json: async () => ({}) }
        : { ok: true, json: async () => ({ data: [NOTE_1] }) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("note-1");
    });

    const del = fetchMock.mock.calls.find(
      ([, init]) =>
        (init as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(del?.[0]).toBe("/api/v1/notes/note-1");
  });

  it("enhance — POST /:id/enhance 결과 본문을 돌려준다", async () => {
    const improved = { ...NOTE_1, content: "# 개선본" };
    const fetchMock = vi.fn(async (url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? { ok: true, json: async () => ({ data: improved }) }
        : { ok: true, json: async () => ({ data: [NOTE_1] }) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: string | null = null;
    await act(async () => {
      returned = await result.current.enhance("note-1");
    });

    expect(returned).toBe("# 개선본");
    const post = fetchMock.mock.calls.find(
      ([, init]) =>
        (init as { method?: string } | undefined)?.method === "POST",
    );
    expect(post?.[0]).toBe("/api/v1/notes/note-1/enhance");
  });

  it("enhance — 실패하면 null 을 돌려주고 error 를 노출한다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? {
            ok: false,
            json: async () => ({
              error: { message: "AI 개선에 실패했습니다." },
            }),
          }
        : { ok: true, json: async () => ({ data: [NOTE_1] }) },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: string | null = "sentinel";
    await act(async () => {
      returned = await result.current.enhance("note-1");
    });

    expect(returned).toBeNull();
    expect(result.current.error).toBe("AI 개선에 실패했습니다.");
  });
});

// @vitest-environment jsdom
// components/sessions/SessionList.tsx — 19-UIUX-UPGRADE.md § P10-T6-02
// 세션 히스토리 사이드바: 날짜그룹 렌더 + 새 세션(POST) + 이름변경(PATCH).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

import { SessionList } from "../SessionList";

describe("SessionList", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    push.mockClear();
    try {
      window.localStorage.clear();
    } catch {
      // localStorage 미가용 테스트 환경 — 다음 테스트도 빈 상태로 시작한다.
    }
  });

  it("세션 목록을 날짜그룹(오늘/어제/이전 7일)으로 렌더한다", async () => {
    const now = new Date("2026-07-14T12:00:00Z");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "sess-today",
              title: "오늘 세션",
              lastMessageAt: "2026-07-14T01:00:00Z",
              projectId: null,
              archived: false,
            },
            {
              id: "sess-yesterday",
              title: "어제 세션",
              lastMessageAt: "2026-07-13T01:00:00Z",
              projectId: null,
              archived: false,
            },
            {
              id: "sess-old",
              title: "지난주 세션",
              lastMessageAt: "2026-07-09T01:00:00Z",
              projectId: null,
              archived: false,
            },
          ],
        }),
      })),
    );

    render(<SessionList now={now} />);

    await waitFor(() => {
      expect(screen.getByText("오늘 세션")).toBeInTheDocument();
    });
    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.getByText("어제")).toBeInTheDocument();
    expect(screen.getByText("이전 7일")).toBeInTheDocument();
    expect(screen.getByText("어제 세션")).toBeInTheDocument();
    expect(screen.getByText("지난주 세션")).toBeInTheDocument();
  });

  it("새 대화 버튼 클릭 시 POST /sessions 호출 후 새 세션으로 이동한다", async () => {
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

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ 새 대화" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/chat/sess-new");
    });
  });

  it("세션 이름변경 시 PATCH /sessions/:id 를 호출한다", async () => {
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
                title: "old title",
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

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("old title")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("이름변경: old title"));
    const input = screen.getByDisplayValue("old title");
    fireEvent.change(input, { target: { value: "new title" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ title: "new title" }),
        }),
      );
    });
  });

  it("고정 버튼 클릭 시 해당 세션이 '고정' 그룹으로 이동한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "sess-a",
              title: "세션 A",
              lastMessageAt: "2026-07-14T01:00:00Z",
              projectId: null,
              archived: false,
            },
          ],
        }),
      })),
    );

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });
    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.queryByText("고정")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("고정: 세션 A"));

    expect(screen.getByText("고정")).toBeInTheDocument();
    expect(screen.queryByText("오늘")).not.toBeInTheDocument();
    expect(screen.getByLabelText("고정 해제: 세션 A")).toBeInTheDocument();
  });

  it("⌘N 단축키로 새 세션을 생성한다", async () => {
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

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);
    await waitFor(() => {
      expect(screen.getByText("세션이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("wchat:cmdk 이벤트 수신 시 세션 검색창에 포커스한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      })),
    );

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);
    await waitFor(() => {
      expect(screen.getByText("세션이 없습니다.")).toBeInTheDocument();
    });

    window.dispatchEvent(new CustomEvent("wchat:cmdk"));

    expect(screen.getByTestId("session-search-input")).toHaveFocus();
  });
});

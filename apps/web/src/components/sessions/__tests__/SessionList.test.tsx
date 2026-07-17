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
  within,
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

  it("고정 버튼 클릭 시 서버 PATCH /pin 을 호출하고 '고정' 그룹으로 이동한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/sessions/sess-a/pin" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: "sess-a", pinned: true } }),
          };
        }
        return {
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
                pinned: false,
              },
            ],
          }),
        };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });
    expect(screen.getByText("오늘")).toBeInTheDocument();
    expect(screen.queryByText("고정")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("고정: 세션 A"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a/pin",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("고정")).toBeInTheDocument();
    });
    expect(screen.queryByText("오늘")).not.toBeInTheDocument();
    expect(screen.getByLabelText("고정 해제: 세션 A")).toBeInTheDocument();
  });

  it("폴더가 있으면 폴더 그룹으로 세션을 렌더한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "업무",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "sess-foldered",
                  title: "폴더 세션",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: "folder-1",
                },
                {
                  id: "sess-plain",
                  title: "일반 세션",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: null,
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("폴더 세션")).toBeInTheDocument();
    });
    expect(screen.getByText("업무")).toBeInTheDocument();
    expect(screen.getByText("일반 세션")).toBeInTheDocument();
    expect(screen.getByText("오늘")).toBeInTheDocument();
  });

  it("폴더 프롬프트 편집 버튼으로 systemPrompt 를 PATCH 한다(P20-T1-03)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "업무",
                  systemPrompt: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (url === "/api/v1/folders/folder-1" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: "folder-1",
                name: "업무",
                systemPrompt: "너는 코드리뷰어다",
                createdAt: "2026-07-14T00:00:00Z",
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
      expect(screen.getByText("업무")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("폴더 프롬프트 편집: 업무"));
    const textarea = screen.getByLabelText("폴더 시스템 프롬프트: 업무");
    fireEvent.change(textarea, { target: { value: "너는 코드리뷰어다" } });
    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/folders/folder-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ systemPrompt: "너는 코드리뷰어다" }),
        }),
      );
    });
  });

  it("세션을 폴더에 할당하면 PATCH /sessions/:id 를 folderId 와 함께 호출한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "업무",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (url === "/api/v1/sessions/sess-a" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { id: "sess-a", folderId: "folder-1" },
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("폴더 지정: 세션 A"));
    const menu = screen.getByTestId("folder-menu-sess-a");
    fireEvent.click(within(menu).getByText("업무"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ folderId: "folder-1" }),
        }),
      );
    });
  });

  it("세션 카드를 폴더 헤더로 드래그앤드롭하면 PATCH /sessions/:id 를 folderId 와 함께 호출한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "업무",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (url === "/api/v1/sessions/sess-a" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { id: "sess-a", folderId: "folder-1" },
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });

    const folderHeader = screen.getByTestId("folder-header-folder-1");
    fireEvent.drop(folderHeader, {
      dataTransfer: { getData: () => "sess-a" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ folderId: "folder-1" }),
        }),
      );
    });
  });

  it("중첩 폴더는 부모 폴더 아래 들여쓰기되어 렌더된다(P20-T1-06)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-parent",
                  name: "부모",
                  parentFolderId: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
                {
                  id: "folder-child",
                  name: "자식",
                  parentFolderId: "folder-parent",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("부모")).toBeInTheDocument();
    });
    expect(screen.getByText("자식")).toBeInTheDocument();

    const parentHeader = screen.getByTestId("folder-header-folder-parent");
    const childHeader = screen.getByTestId("folder-header-folder-child");
    const parentPaddingLeft = parseFloat(
      (parentHeader as HTMLElement).style.paddingLeft || "0",
    );
    const childPaddingLeft = parseFloat(
      (childHeader as HTMLElement).style.paddingLeft || "0",
    );
    expect(childPaddingLeft).toBeGreaterThan(parentPaddingLeft);
  });

  it("부모 폴더를 접으면 자식 폴더도 함께 숨겨진다(P20-T1-06)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-parent",
                  name: "부모",
                  parentFolderId: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
                {
                  id: "folder-child",
                  name: "자식",
                  parentFolderId: "folder-parent",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("자식")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("접기: 부모"));

    await waitFor(() => {
      expect(screen.queryByText("자식")).not.toBeInTheDocument();
    });
  });

  it("중첩(비-루트) 폴더에 할당된 세션은 해당 폴더 아래 렌더되고 미분류 목록에 나타나지 않는다(P20-T1-06)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-parent",
                  name: "부모",
                  parentFolderId: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
                {
                  id: "folder-child",
                  name: "자식",
                  parentFolderId: "folder-parent",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "sess-nested",
                  title: "중첩 폴더 세션",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: "folder-child",
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("중첩 폴더 세션")).toBeInTheDocument();
    });
    expect(screen.queryByText("세션이 없습니다.")).not.toBeInTheDocument();
    expect(screen.queryByText("오늘")).not.toBeInTheDocument();
  });

  it("폴더 헤더를 다른 폴더 헤더로 드래그하면 moveFolder(PATCH parentFolderId) 를 호출한다(P20-T1-06)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "폴더1",
                  parentFolderId: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
                {
                  id: "folder-2",
                  name: "폴더2",
                  parentFolderId: null,
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (url === "/api/v1/folders/folder-2" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: "folder-2",
                name: "폴더2",
                parentFolderId: "folder-1",
                createdAt: "2026-07-14T00:00:00Z",
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
      expect(screen.getByText("폴더1")).toBeInTheDocument();
    });

    const targetHeader = screen.getByTestId("folder-header-folder-1");
    fireEvent.drop(targetHeader, {
      dataTransfer: {
        types: ["application/x-wchat-folder-id"],
        getData: (type: string) =>
          type === "application/x-wchat-folder-id" ? "folder-2" : "",
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/folders/folder-2",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ parentFolderId: "folder-1" }),
        }),
      );
    });
  });

  it("세션 카드를 폴더 헤더로 드래그앤드롭하면 여전히 세션 할당을 호출한다(폴더 드래그 타입 미검출 시 회귀 방지)", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/folders" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "folder-1",
                  name: "업무",
                  createdAt: "2026-07-14T00:00:00Z",
                },
              ],
            }),
          };
        }
        if (url === "/api/v1/sessions/sess-a" && init?.method === "PATCH") {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { id: "sess-a", folderId: "folder-1" },
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });

    const folderHeader = screen.getByTestId("folder-header-folder-1");
    fireEvent.drop(folderHeader, {
      dataTransfer: { getData: () => "sess-a" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ folderId: "folder-1" }),
        }),
      );
    });
  });

  it("＋ 폴더 버튼으로 새 폴더를 생성한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/folders" && init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: {
                id: "folder-new",
                name: "새 폴더",
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

    fireEvent.click(screen.getByRole("button", { name: "＋ 폴더" }));
    const input = screen.getByPlaceholderText("새 폴더 이름");
    fireEvent.change(input, { target: { value: "새 폴더" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/folders",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "새 폴더" }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("새 폴더")).toBeInTheDocument();
    });
  });

  it("태그가 있는 세션은 사이드바에 태그 필터 칩을 렌더하고 클릭 시 해당 태그로 필터한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                  tags: ["업무"],
                },
                {
                  id: "sess-b",
                  title: "세션 B",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });
    expect(screen.getByText("세션 B")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "업무" }));

    await waitFor(() => {
      expect(screen.queryByText("세션 B")).not.toBeInTheDocument();
    });
    expect(screen.getByText("세션 A")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "업무" }));

    await waitFor(() => {
      expect(screen.getByText("세션 B")).toBeInTheDocument();
    });
  });

  it("세션에 태그를 추가하면 POST /sessions/:id/tags 를 호출한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/v1/sessions/sess-a/tags" && init?.method === "POST") {
          return {
            ok: true,
            status: 201,
            json: async () => ({
              data: { sessionId: "sess-a", tag: "신규" },
            }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("태그 지정: 세션 A"));
    const input = screen.getByPlaceholderText("새 태그");
    fireEvent.change(input, { target: { value: "신규" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a/tags",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ tag: "신규" }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.getByLabelText("태그 제거: 신규")).toBeInTheDocument();
    });
  });

  it("세션 보관 버튼 클릭 시 PATCH /:id/archive 를 호출하고 목록에서 제거한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/sessions/sess-a/archive" &&
          init?.method === "PATCH"
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: "sess-a", archived: true } }),
          };
        }
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
              ],
            }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("보관: 세션 A"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-a/archive",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("세션 A")).not.toBeInTheDocument();
    });
  });

  it("보관함 버튼 클릭 시 GET ?archived=true 로 보관된 세션을 불러와 표시하고, 복원 클릭 시 목록에서 제거한다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/sessions/sess-b/archive" &&
          init?.method === "PATCH"
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id: "sess-b", archived: false } }),
          };
        }
        if (
          url === "/api/v1/sessions?archived=true" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                {
                  id: "sess-b",
                  title: "보관된 세션",
                  lastMessageAt: "2026-07-10T01:00:00Z",
                  projectId: null,
                  archived: true,
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
              ],
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

    fireEvent.click(screen.getByRole("button", { name: "보관함" }));

    await waitFor(() => {
      expect(screen.getByText("보관된 세션")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("복원: 보관된 세션"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/sess-b/archive",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("보관된 세션")).not.toBeInTheDocument();
    });
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

  it("검색어 입력 시 서버 내용검색 결과를 스니펫과 함께 렌더한다", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/v1/sessions/search")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-content-match",
                title: "예산 회의록",
                lastMessageAt: "2026-07-12T01:00:00Z",
                snippet: "…3분기 예산은 전년 대비 12% 증가…",
              },
            ],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);
    await waitFor(() => {
      expect(screen.getByText("세션이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("session-search-input"), {
      target: { value: "예산" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/sessions/search?q="),
        expect.anything(),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("예산 회의록")).toBeInTheDocument();
    });
    expect(
      screen.getByText("…3분기 예산은 전년 대비 12% 증가…"),
    ).toBeInTheDocument();
  });

  it("목록 하단 sentinel 이 뷰포트에 들어오면 다음 페이지를 로드해 세션을 append 한다", async () => {
    const callbackRef: { current: IntersectionObserverCallback | null } = {
      current: null,
    };
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeIntersectionObserver {
      constructor(cb: IntersectionObserverCallback) {
        callbackRef.current = cb;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
    }
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/sessions") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-page1",
                title: "첫 페이지 세션",
                lastMessageAt: "2026-07-14T01:00:00Z",
                projectId: null,
                archived: false,
              },
            ],
            meta: { requestId: "r1", nextCursor: "cursor-1" },
          }),
        };
      }
      if (url === "/api/v1/sessions?cursor=cursor-1") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "sess-page2",
                title: "두번째 페이지 세션",
                lastMessageAt: "2026-07-09T01:00:00Z",
                projectId: null,
                archived: false,
              },
            ],
            meta: { requestId: "r2" },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);
    await waitFor(() => {
      expect(screen.getByText("첫 페이지 세션")).toBeInTheDocument();
    });
    expect(observe).toHaveBeenCalled();

    await waitFor(() => {
      expect(callbackRef.current).not.toBeNull();
    });
    callbackRef.current?.(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions?cursor=cursor-1",
        expect.objectContaining({ credentials: "include" }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("두번째 페이지 세션")).toBeInTheDocument();
    });
  });

  it("선택 모드에서 체크박스로 3개 선택 후 일괄 보관하면 3건 모두 목록에서 사라진다(P20-T6-08)", async () => {
    const archiveCalls: string[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url === "/api/v1/sessions" &&
          (!init?.method || init.method === "GET")
        ) {
          return {
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
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
                {
                  id: "sess-b",
                  title: "세션 B",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
                {
                  id: "sess-c",
                  title: "세션 C",
                  lastMessageAt: "2026-07-14T01:00:00Z",
                  projectId: null,
                  archived: false,
                  pinned: false,
                  folderId: null,
                  tags: [],
                },
              ],
            }),
          };
        }
        const archiveMatch = url.match(
          /^\/api\/v1\/sessions\/(sess-[abc])\/archive$/,
        );
        if (archiveMatch && init?.method === "PATCH") {
          const id = archiveMatch[1] as string;
          archiveCalls.push(id);
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: { id, archived: true } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<SessionList now={new Date("2026-07-14T12:00:00Z")} />);

    await waitFor(() => {
      expect(screen.getByText("세션 A")).toBeInTheDocument();
      expect(screen.getByText("세션 B")).toBeInTheDocument();
      expect(screen.getByText("세션 C")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "다중 선택" }));

    fireEvent.click(screen.getByLabelText("선택: 세션 A"));
    fireEvent.click(screen.getByLabelText("선택: 세션 B"));
    fireEvent.click(screen.getByLabelText("선택: 세션 C"));

    fireEvent.click(screen.getByRole("button", { name: /선택 항목 보관/ }));

    await waitFor(() => {
      expect(archiveCalls.sort()).toEqual(["sess-a", "sess-b", "sess-c"]);
    });
    await waitFor(() => {
      expect(screen.queryByText("세션 A")).not.toBeInTheDocument();
      expect(screen.queryByText("세션 B")).not.toBeInTheDocument();
      expect(screen.queryByText("세션 C")).not.toBeInTheDocument();
    });
  });
});

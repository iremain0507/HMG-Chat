// @vitest-environment jsdom
// components/chat/ShareExportMenu.tsx — P10-T6-16 공유/내보내기.
//   내보내기(md/JSON, downloadTextFile 트리거)는 즉시 실행, 공유는 opt-in 확인 후에만
//   기존 ShareDialog(POST/DELETE /artifacts/:id/share)를 연다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { downloadTextFile } = vi.hoisted(() => ({
  downloadTextFile: vi.fn(),
}));

// P22-T6-13 — 가져오기는 네트워크를 타므로 클라이언트 헬퍼를 목킹하고, 컴포넌트가
// (1) 고른 File 을 그대로 넘기는지 (2) 성공시에만 목록 갱신 이벤트를 쏘는지를 단언한다.
const { importConversationsFromFile } = vi.hoisted(() => ({
  importConversationsFromFile: vi.fn(),
}));
vi.mock("../../../lib/importConversations", () => ({
  importConversationsFromFile,
  SESSIONS_CHANGED_EVENT: "wchat:sessions-changed",
}));
vi.mock("../../../lib/export-conversation", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/export-conversation")
  >("../../../lib/export-conversation");
  return { ...actual, downloadTextFile };
});

import { ShareExportMenu } from "../ShareExportMenu";

const MESSAGES = [
  { role: "user" as const, content: "안녕하세요" },
  { role: "assistant" as const, content: "안녕하세요! 무엇을 도와드릴까요?" },
];

describe("ShareExportMenu", () => {
  afterEach(() => {
    cleanup();
    downloadTextFile.mockClear();
  });

  it("트리거 클릭 시 메뉴가 열린다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(screen.getByTestId("share-export-menu")).toBeInTheDocument();
  });

  it("마크다운으로 내보내기를 누르면 downloadTextFile 이 .md 로 호출된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(
      screen.getByRole("button", { name: "마크다운으로 내보내기" }),
    );
    expect(downloadTextFile).toHaveBeenCalledWith(
      "테스트 대화.md",
      expect.stringContaining("### User"),
      "text/markdown",
    );
    expect(screen.queryByTestId("share-export-menu")).not.toBeInTheDocument();
  });

  it("JSON으로 내보내기를 누르면 downloadTextFile 이 .json 으로 호출된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "JSON으로 내보내기" }));
    expect(downloadTextFile).toHaveBeenCalledWith(
      "테스트 대화.json",
      expect.stringContaining('"messages"'),
      "application/json",
    );
  });

  it("PDF로 내보내기를 누르면 인쇄뷰(대화 전체)가 렌더되고 window.print 가 호출된다", () => {
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "PDF로 내보내기" }));

    expect(printSpy).toHaveBeenCalledTimes(1);
    const printView = screen.getByTestId("chat-print-view");
    expect(printView).toHaveTextContent("테스트 대화");
    expect(printView).toHaveTextContent("안녕하세요");
    expect(printView).toHaveTextContent("무엇을 도와드릴까요");
    expect(screen.queryByTestId("share-export-menu")).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("세션에 아티팩트가 없으면 대화 공유 버튼이 비활성화된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(screen.getByRole("button", { name: "대화 공유" })).toBeDisabled();
  });

  it("대화 공유 클릭 시 opt-in 확인 문구가 먼저 뜨고, 확인 전엔 공유 다이얼로그가 뜨지 않는다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));

    expect(screen.getByTestId("share-confirm")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "공유" }),
    ).not.toBeInTheDocument();
  });

  it("opt-in 확인에서 취소하면 공유 다이얼로그가 열리지 않는다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByTestId("share-confirm")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "공유" }),
    ).not.toBeInTheDocument();
  });

  it("opt-in 확인에서 공유를 누르면 기존 ShareDialog 가 최신 아티팩트로 열린다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report-v1.md",
            sizeBytes: 100,
          },
          {
            artifactId: "artifact-2",
            artifactKind: "markdown",
            filename: "report-v2.md",
            sizeBytes: 200,
          },
        ]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));
    fireEvent.click(screen.getByTestId("share-confirm-accept"));

    expect(screen.getByRole("dialog", { name: "공유" })).toBeInTheDocument();
  });

  // P20-T1-08 대화 스냅샷 공유 — 아티팩트 유무와 무관하게 항상 활성화, opt-in 확인 없이
  // 바로 ConversationShareDialog 를 연다.
  it("아티팩트가 없어도 대화 스냅샷 공유 버튼은 항상 활성화된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(
      screen.getByRole("button", { name: "대화 스냅샷 공유" }),
    ).not.toBeDisabled();
  });

  it("대화 스냅샷 공유 클릭 시 opt-in 확인 없이 바로 스냅샷 공유 다이얼로그가 열린다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 스냅샷 공유" }));

    expect(
      screen.getByRole("dialog", { name: "대화 스냅샷 공유" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("share-confirm")).not.toBeInTheDocument();
  });

  it("스냅샷 공유 링크 생성 버튼을 누르면 POST /sessions/:id/share-snapshot 후 URL 을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            token: "snap-tok-1",
            url: "https://app.example.com/share/conversations/snap-tok-1",
            expiresAt: null,
          },
        }),
      })),
    );

    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 스냅샷 공유" }));
    fireEvent.click(
      screen.getByRole("button", { name: "스냅샷 공유 링크 생성" }),
    );

    await screen.findByDisplayValue(
      "https://app.example.com/share/conversations/snap-tok-1",
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/share-snapshot",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("스냅샷 링크 해제 버튼을 누르면 DELETE /sessions/:id/share-snapshot/:token 후 생성 버튼으로 되돌아간다", async () => {
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return { ok: true };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            token: "snap-tok-1",
            url: "https://app.example.com/share/conversations/snap-tok-1",
            expiresAt: null,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 스냅샷 공유" }));
    fireEvent.click(
      screen.getByRole("button", { name: "스냅샷 공유 링크 생성" }),
    );
    await screen.findByDisplayValue(
      "https://app.example.com/share/conversations/snap-tok-1",
    );

    fireEvent.click(screen.getByRole("button", { name: "링크 해제" }));

    await screen.findByRole("button", { name: "스냅샷 공유 링크 생성" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/share-snapshot/snap-tok-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    vi.unstubAllGlobals();
  });

  // P21-T6-05 — 드롭다운 라이트-디스미스 + confirm 실 모달화.
  it("UX-01: 메뉴 밖 pointerdown 시 메뉴가 unmount 된다", () => {
    render(
      <>
        <button data-testid="outside">밖</button>
        <ShareExportMenu
          title="테스트 대화"
          messages={MESSAGES}
          artifacts={[]}
          sessionId="session-1"
        />
      </>,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(screen.getByTestId("share-export-menu")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("share-export-menu")).not.toBeInTheDocument();
  });

  it("UX-03: Escape 시 메뉴가 닫히고 포커스가 트리거로 복귀한다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    const trigger = screen.getByTestId("share-export-trigger");
    fireEvent.click(trigger);
    expect(screen.getByTestId("share-export-menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("share-export-menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("트리거는 aria-haspopup=menu 이고 메뉴 오픈 상태를 aria-expanded 로 announce 한다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    const trigger = screen.getByTestId("share-export-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("UX-08/09: 공유 확인 오픈 시 포커스가 패널 내부로 이동하고 Tab 이 패널 안에서 순환한다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));

    const confirm = screen.getByTestId("share-confirm");
    expect(confirm).toHaveAttribute("aria-modal", "true");
    expect(confirm).toContainElement(
      document.activeElement as HTMLElement | null,
    );

    const cancelBtn = screen.getByRole("button", { name: "취소" });
    const acceptBtn = screen.getByTestId("share-confirm-accept");
    acceptBtn.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancelBtn);
  });

  it("UX-10: 공유 확인에서 Escape 시 닫히고 포커스가 트리거로 복귀한다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
        sessionId="session-1"
      />,
    );
    const trigger = screen.getByTestId("share-export-trigger");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));
    expect(screen.getByTestId("share-confirm")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("share-confirm")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });
});

// P22-T6-13(계약배치 C9) — 대화 가져오기. 메뉴에서 파일을 고르면 클라이언트가 JSON 을 읽어
// 포맷을 판별하고 POST /api/v1/sessions/import 로 넘긴 뒤, 세션 목록 갱신 이벤트를 발행한다.
describe("ShareExportMenu — 대화 가져오기 (P22-T6-13)", () => {
  afterEach(() => {
    cleanup();
    importConversationsFromFile.mockReset();
  });

  function openImportMenu() {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
        sessionId="session-1"
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
  }

  it("메뉴에 '대화 가져오기' 항목과 숨은 파일 입력이 있다", () => {
    openImportMenu();
    expect(
      screen.getByRole("button", { name: "대화 가져오기" }),
    ).toBeInTheDocument();
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    expect(input.type).toBe("file");
    expect(input.accept).toContain("json");
  });

  it("'대화 가져오기' 클릭은 숨은 파일 입력을 연다", () => {
    openImportMenu();
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "대화 가져오기" }));
    expect(click).toHaveBeenCalled();
  });

  it("파일을 고르면 import 를 호출하고 성공 시 세션 목록 갱신 이벤트를 발행한다", async () => {
    importConversationsFromFile.mockResolvedValue({
      ok: true,
      createdSessionIds: ["s-1", "s-2"],
    });
    const listener = vi.fn();
    window.addEventListener("wchat:sessions-changed", listener);
    openImportMenu();
    const file = new File(
      [JSON.stringify({ title: "t", messages: [] })],
      "c.json",
      { type: "application/json" },
    );
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(importConversationsFromFile).toHaveBeenCalledWith(file),
    );
    await waitFor(() => expect(listener).toHaveBeenCalled());
    window.removeEventListener("wchat:sessions-changed", listener);
  });

  it("가져오기가 실패하면 갱신 이벤트를 발행하지 않는다", async () => {
    importConversationsFromFile.mockResolvedValue({
      ok: false,
      createdSessionIds: [],
    });
    const listener = vi.fn();
    window.addEventListener("wchat:sessions-changed", listener);
    openImportMenu();
    const input = screen.getByTestId("import-file-input") as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["{}"], "c.json")] },
    });
    await waitFor(() => expect(importConversationsFromFile).toHaveBeenCalled());
    expect(listener).not.toHaveBeenCalled();
    window.removeEventListener("wchat:sessions-changed", listener);
  });
});

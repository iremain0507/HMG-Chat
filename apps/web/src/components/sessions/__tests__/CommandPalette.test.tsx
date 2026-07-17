// @vitest-environment jsdom
// components/sessions/CommandPalette.tsx — P20-T6-02 전역 검색 커맨드 팔레트(⌘K/Ctrl+K).
// AppShell 헤더 ⌘K 버튼/단축키가 여는 오버레이. lib/sessionSearch.searchSessions 를
// 200ms debounce 로 호출해 결과를 렌더하고, 클릭 시 /chat/:id 로 라우팅한다.
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("../../../lib/sessionSearch", () => ({
  searchSessions: vi.fn(),
}));

import { CommandPalette } from "../CommandPalette";
import { searchSessions } from "../../../lib/sessionSearch";

describe("CommandPalette", () => {
  beforeEach(() => {
    push.mockClear();
    vi.mocked(searchSessions).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("open=false 이면 command-palette 가 문서에 없다", () => {
    render(<CommandPalette open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId("command-palette")).not.toBeInTheDocument();
  });

  it("open=true 이면 command-palette 와 입력창이 렌더되고 입력창이 포커스된다", () => {
    render(<CommandPalette open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("command-palette")).toBeInTheDocument();
    const input = screen.getByTestId("command-palette-input");
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("쿼리 입력 후 200ms debounce 뒤 searchSessions 를 호출하고 결과를 렌더한다", async () => {
    vi.mocked(searchSessions).mockResolvedValue([
      {
        id: "sess-1",
        title: "첫 번째 세션",
        lastMessageAt: "2026-07-14T01:00:00Z",
      },
      {
        id: "sess-2",
        title: null,
        lastMessageAt: null,
      },
    ]);

    render(<CommandPalette open={true} onClose={vi.fn()} />);
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "회의록" } });

    expect(searchSessions).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(searchSessions).toHaveBeenCalledWith("회의록", expect.anything());
    });

    await waitFor(() => {
      expect(screen.getByText("첫 번째 세션")).toBeInTheDocument();
      expect(screen.getByText("제목 없음")).toBeInTheDocument();
    });
  });

  it("검색 결과가 빈 배열이면 결과 없음 문구를 표시한다", async () => {
    vi.mocked(searchSessions).mockResolvedValue([]);

    render(<CommandPalette open={true} onClose={vi.fn()} />);
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "존재하지않음" } });

    await waitFor(() => {
      expect(screen.getByTestId("command-palette-empty")).toBeInTheDocument();
    });
  });

  it("결과 클릭 시 /chat/:id 로 이동하고 onClose 를 호출한다", async () => {
    vi.mocked(searchSessions).mockResolvedValue([
      {
        id: "sess-1",
        title: "첫 번째 세션",
        lastMessageAt: "2026-07-14T01:00:00Z",
      },
    ]);
    const onClose = vi.fn();

    render(<CommandPalette open={true} onClose={onClose} />);
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, { target: { value: "회의록" } });

    await waitFor(() => {
      expect(
        screen.getByTestId("command-palette-result-sess-1"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("command-palette-result-sess-1"));
    expect(push).toHaveBeenCalledWith("/chat/sess-1");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // P20-T1-07 — 검색 접두어(tag:/folder:/pinned:/archived:) 힌트칩.
  it("힌트칩 4종(tag:/folder:/pinned:true/archived:true)이 렌더된다", () => {
    render(<CommandPalette open={true} onClose={vi.fn()} />);
    expect(screen.getByTestId("command-palette-hint-tag")).toHaveTextContent(
      "tag:",
    );
    expect(screen.getByTestId("command-palette-hint-folder")).toHaveTextContent(
      "folder:",
    );
    expect(screen.getByTestId("command-palette-hint-pinned")).toHaveTextContent(
      "pinned:true",
    );
    expect(
      screen.getByTestId("command-palette-hint-archived"),
    ).toHaveTextContent("archived:true");
  });

  it("힌트칩 클릭 시 입력창에 접두어가 삽입되고 포커스가 유지된다", () => {
    render(<CommandPalette open={true} onClose={vi.fn()} />);
    const input = screen.getByTestId(
      "command-palette-input",
    ) as HTMLInputElement;
    fireEvent.click(screen.getByTestId("command-palette-hint-tag"));
    expect(input.value).toBe("tag:");
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "tag:report" } });
    fireEvent.click(screen.getByTestId("command-palette-hint-archived"));
    expect(input.value).toBe("tag:report archived:true");
  });

  it("접두어가 포함된 쿼리를 서버로 그대로(잘리지 않고) 전달한다", async () => {
    vi.mocked(searchSessions).mockResolvedValue([]);
    render(<CommandPalette open={true} onClose={vi.fn()} />);
    const input = screen.getByTestId("command-palette-input");
    fireEvent.change(input, {
      target: { value: "tag:report folder:업무 예산" },
    });

    await waitFor(() => {
      expect(searchSessions).toHaveBeenCalledWith(
        "tag:report folder:업무 예산",
        expect.anything(),
      );
    });
  });

  it("Escape 키로 닫힌다", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("배경 클릭으로 닫힌다", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("command-palette-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // P21-T6-10 — useFocusTrap 이식: Tab 트랩 + 닫을 때 트리거(⌘K 버튼) 포커스 복귀.
  it("Shift+Tab 은 다이얼로그 밖으로 벗어나지 않고 마지막 힌트칩으로 순환한다", () => {
    render(<CommandPalette open={true} onClose={vi.fn()} />);
    const input = screen.getByTestId("command-palette-input");
    expect(input).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(
      screen.getByTestId("command-palette-hint-archived"),
    );
  });

  it("닫힐 때(Escape) 트리거 요소로 포커스가 복귀한다", () => {
    function Wrapper() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            검색
          </button>
          {open && (
            <CommandPalette open={open} onClose={() => setOpen(false)} />
          )}
        </div>
      );
    }
    render(<Wrapper />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByTestId("command-palette")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveFocus();
  });
});

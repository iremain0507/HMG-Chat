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

  it("Escape 키로 닫힌다", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("배경 클릭으로 닫힌다", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("command-palette-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

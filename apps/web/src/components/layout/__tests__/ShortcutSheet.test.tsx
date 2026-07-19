// @vitest-environment jsdom
// components/layout/ShortcutSheet.tsx — TS-22#5 키보드 단축키 도움말/치트시트 오버레이.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ShortcutSheet } from "../ShortcutSheet";

describe("ShortcutSheet", () => {
  afterEach(() => {
    cleanup();
  });

  it("open=false 면 렌더하지 않는다", () => {
    render(<ShortcutSheet open={false} onClose={() => {}} />);
    expect(screen.queryByTestId("shortcut-sheet")).not.toBeInTheDocument();
  });

  it("open=true 면 단축키 목록을 렌더한다", () => {
    render(<ShortcutSheet open={true} onClose={() => {}} />);
    const sheet = screen.getByTestId("shortcut-sheet");
    expect(sheet).toBeInTheDocument();
    expect(sheet).toHaveTextContent("⌘K");
    expect(sheet).toHaveTextContent("⌘N");
    expect(sheet).toHaveTextContent("⌘\\");
    expect(sheet).toHaveTextContent("⌘B");
    expect(sheet).toHaveTextContent("⌘/");
  });

  it("Esc 키로 닫힌다", () => {
    const onClose = vi.fn();
    render(<ShortcutSheet open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("배경 클릭으로 닫힌다", () => {
    const onClose = vi.fn();
    render(<ShortcutSheet open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("shortcut-sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("닫기 버튼 클릭으로 닫힌다", () => {
    const onClose = vi.fn();
    render(<ShortcutSheet open={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("닫기"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // P21-T6-10 — useFocusTrap 이식: 오픈 시 포커스 이동 + Tab 트랩 + 닫을 때 트리거 포커스 복귀.
  it("열리면 첫 포커스 가능 요소(닫기 버튼)로 포커스가 이동한다", () => {
    render(<ShortcutSheet open={true} onClose={vi.fn()} />);
    expect(screen.getByLabelText("닫기")).toHaveFocus();
  });

  it("Tab 은 다이얼로그 밖으로 벗어나지 않고 첫 요소(닫기 버튼)로 순환한다", () => {
    render(<ShortcutSheet open={true} onClose={vi.fn()} />);
    const closeButton = screen.getByLabelText("닫기");
    expect(closeButton).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(closeButton);
  });

  it("닫힐 때(Escape) 트리거 요소로 포커스가 복귀한다", () => {
    function Wrapper() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            단축키
          </button>
          {open && <ShortcutSheet open={open} onClose={() => setOpen(false)} />}
        </div>
      );
    }
    render(<Wrapper />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    expect(screen.getByTestId("shortcut-sheet")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(trigger).toHaveFocus();
  });
});

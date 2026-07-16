// @vitest-environment jsdom
// hooks/useFocusTrap.ts — P17-T6-09(TS-26) 모달 a11y: 포커스 가둠 + Esc 위임 + 포커스 복귀.
import React, { useRef, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useFocusTrap } from "../useFocusTrap";

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, {
    active: open,
    onClose: () => {
      onClose();
      setOpen(false);
    },
  });
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        trigger
      </button>
      {open && (
        <div ref={ref} role="dialog">
          <button data-testid="first">first</button>
          <button data-testid="last">last</button>
        </div>
      )}
    </div>
  );
}

describe("useFocusTrap", () => {
  afterEach(() => cleanup());

  it("활성화되면 컨테이너 내 첫 포커스 가능 요소로 포커스를 옮긴다", () => {
    render(<Harness onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("trigger"));
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("마지막 요소에서 Tab 하면 첫 요소로 순환한다", () => {
    render(<Harness onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("trigger"));
    screen.getByTestId("last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  it("첫 요소에서 Shift+Tab 하면 마지막 요소로 순환한다", () => {
    render(<Harness onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId("trigger"));
    screen.getByTestId("first").focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  it("Escape 를 누르면 onClose 를 호출한다", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId("trigger"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("닫힐 때 트리거 요소로 포커스를 복귀한다", () => {
    render(<Harness onClose={vi.fn()} />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
});

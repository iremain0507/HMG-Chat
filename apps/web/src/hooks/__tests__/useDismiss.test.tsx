// @vitest-environment jsdom
// hooks/useDismiss.ts — P21-T6-01: 오버레이 라이트-디스미스(바깥 pointerdown + Escape) 공용 훅.
import React, { useRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useDismiss } from "../useDismiss";

function Harness({
  onDismiss,
  enabled = true,
}: {
  onDismiss: () => void;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, onDismiss, { enabled });
  return (
    <div>
      <button data-testid="outside">outside</button>
      <div ref={ref} data-testid="inside">
        <button data-testid="inner-button">inner</button>
      </div>
    </div>
  );
}

describe("useDismiss", () => {
  afterEach(() => cleanup());

  it("ref 밖 pointerdown 시 onDismiss 를 호출한다", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ref 내부 pointerdown 시 onDismiss 를 호출하지 않는다", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.pointerDown(screen.getByTestId("inner-button"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("Escape 를 누르면 onDismiss 를 호출한다", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 일 때는 document 리스너를 부착하지 않는다(바깥 클릭/Escape 무시)", () => {
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} enabled={false} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("enabled=false 일 때 addEventListener 를 document 에 호출하지 않는다", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    const onDismiss = vi.fn();
    render(<Harness onDismiss={onDismiss} enabled={false} />);
    expect(addSpy).not.toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
    );
    expect(addSpy).not.toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
  });

  it("언마운트 시 리스너를 정리한다", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Harness onDismiss={onDismiss} />);
    unmount();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

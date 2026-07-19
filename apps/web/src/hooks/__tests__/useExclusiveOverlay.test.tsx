// @vitest-environment jsdom
// hooks/useExclusiveOverlay.ts — P21-T6-02: 단일-오픈 오버레이 조정자(여러 메뉴 동시 오픈 방지).
import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useExclusiveOverlay } from "../useExclusiveOverlay";
import { resetOverlayRegistry } from "../../lib/overlay-registry";

describe("useExclusiveOverlay", () => {
  afterEach(() => resetOverlayRegistry());

  it("A.open() 후 B.open() 시 A.isOpen 은 false 로 바뀐다(단일-오픈)", () => {
    const { result: a } = renderHook(() => useExclusiveOverlay("a"));
    const { result: b } = renderHook(() => useExclusiveOverlay("b"));

    act(() => a.current.open());
    expect(a.current.isOpen).toBe(true);

    act(() => b.current.open());
    expect(b.current.isOpen).toBe(true);
    expect(a.current.isOpen).toBe(false);
  });

  it("close() 호출 시 isOpen 이 false 가 된다", () => {
    const { result } = renderHook(() => useExclusiveOverlay("solo"));
    act(() => result.current.open());
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });

  it("언마운트 시 레지스트리에서 자신을 해제한다(잔여 참조가 다음 open 을 방해하지 않음)", () => {
    const { result: a, unmount } = renderHook(() => useExclusiveOverlay("a2"));
    act(() => a.current.open());
    unmount();

    const { result: b } = renderHook(() => useExclusiveOverlay("b2"));
    act(() => b.current.open());
    expect(b.current.isOpen).toBe(true);
  });
});

// @vitest-environment jsdom
// hooks/useOnlineStatus.ts — P10-T6-17 에러/신뢰: window online/offline 이벤트를 구독해
// 오프라인 상태를 노출한다(ChatView 배너 + ChatInput 비활성화가 소비).
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "../useOnlineStatus";

describe("useOnlineStatus", () => {
  it("online/offline 이벤트에 따라 상태가 바뀐다", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });
});

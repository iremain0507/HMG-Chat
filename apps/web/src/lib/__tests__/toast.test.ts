// lib/toast.ts — P10-T6-17 에러/신뢰: 앱레벨 토스트 이벤트 스토어(pub-sub).
//   컴포넌트 트리 어디서든(HITL/에러/오프라인 등) showToast() 로 알림을 올리고,
//   ToastContainer 가 subscribeToasts() 로 구독해 렌더한다.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  showToast,
  dismissToast,
  subscribeToasts,
  __resetToastsForTest,
  MAX_TOASTS,
  type ToastItem,
} from "../toast";

describe("toast store", () => {
  afterEach(() => {
    __resetToastsForTest();
    vi.useRealTimers();
  });

  it("showToast 가 구독자에게 새 토스트를 알리고 dismissToast 로 제거된다", () => {
    const received: unknown[][] = [];
    const unsubscribe = subscribeToasts((toasts) => received.push(toasts));
    const id = showToast("error", "문제가 발생했습니다", 0);

    expect(received.at(-1)).toEqual([
      { id, kind: "error", message: "문제가 발생했습니다" },
    ]);

    dismissToast(id);
    expect(received.at(-1)).toEqual([]);
    unsubscribe();
  });

  it("durationMs 경과 후 자동으로 dismiss 된다", () => {
    vi.useFakeTimers();
    const received: unknown[][] = [];
    subscribeToasts((toasts) => received.push(toasts));

    showToast("info", "저장됨", 1000);
    expect(received.at(-1)).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(received.at(-1)).toHaveLength(0);
  });

  it("unsubscribe 이후에는 더 이상 알림을 받지 않는다", () => {
    const received: unknown[][] = [];
    const unsubscribe = subscribeToasts((toasts) => received.push(toasts));
    unsubscribe();
    showToast("success", "완료", 0);
    expect(received).toHaveLength(1); // subscribe 시점의 초기 알림 1건뿐
  });

  it("상한(MAX_TOASTS) 초과 시 가장 오래된 토스트부터 evict 된다(UX-22)", () => {
    const received: unknown[][] = [];
    subscribeToasts((toasts) => received.push(toasts));

    for (let i = 0; i < MAX_TOASTS + 2; i++) {
      showToast("info", `메시지-${i}`, 0);
    }

    const last = received.at(-1) as ToastItem[];
    expect(last).toHaveLength(MAX_TOASTS);
    // 가장 오래된 두 건(0,1)은 evict, 최신 MAX_TOASTS 건만 남는다
    expect(last.some((t) => t.message === "메시지-0")).toBe(false);
    expect(last.some((t) => t.message === "메시지-1")).toBe(false);
    expect(last.at(-1)?.message).toBe(`메시지-${MAX_TOASTS + 1}`);
  });

  it("동일 kind+message 의 토스트는 병합되어 누적되지 않는다(UX-22)", () => {
    const received: unknown[][] = [];
    subscribeToasts((toasts) => received.push(toasts));

    const firstId = showToast("error", "연결이 끊어졌습니다", 0);
    showToast("error", "연결이 끊어졌습니다", 0);
    showToast("error", "연결이 끊어졌습니다", 0);

    const last = received.at(-1) as ToastItem[];
    expect(last).toHaveLength(1);
    expect(last[0]?.id).toBe(firstId);
  });
});

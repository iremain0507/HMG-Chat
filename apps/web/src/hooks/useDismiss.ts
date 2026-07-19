"use client";

// hooks/useDismiss.ts — P21-T6-01: 오버레이(메뉴/드롭다운/팝오버) 공용 라이트-디스미스.
// 바깥 pointerdown 또는 Escape 시 onDismiss 호출. enabled(열림) 일 때만 document 리스너 부착.
import { useEffect, useRef, type RefObject } from "react";

export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options?: { enabled?: boolean; triggerRef?: RefObject<HTMLElement | null> },
): void {
  const enabled = options?.enabled ?? true;
  const triggerRef = options?.triggerRef;
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!enabled) return;

    function isInside(target: EventTarget | null): boolean {
      if (!(target instanceof Node)) return false;
      if (ref.current?.contains(target)) return true;
      if (triggerRef?.current?.contains(target)) return true;
      return false;
    }

    function onPointerDown(e: PointerEvent) {
      if (isInside(e.target)) return;
      onDismissRef.current();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      onDismissRef.current();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [enabled, ref, triggerRef]);
}

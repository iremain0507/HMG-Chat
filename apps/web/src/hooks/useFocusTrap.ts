"use client";

// hooks/useFocusTrap.ts — P17-T6-09(TS-26) 모달 a11y 공용 훅.
// 활성화 시 컨테이너 내부로 Tab 순환을 가두고, Esc 는 onClose 로 위임하며,
// 비활성화(언마운트/active=false) 시 트리거(활성화 직전 포커스 요소)로 포커스를 복귀한다.
import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: {
    active: boolean;
    onClose: () => void;
    // P21-T6-10 — 트리거 클릭과 모달 마운트 사이에 다른 동기 side-effect(예: 다른 요소로의
    // 포커스 이동)가 끼어들면 암시적 document.activeElement 캡처가 엉뚱한 요소를 잡는다.
    // 그런 경우 호출부가 실제 트리거 요소를 명시적으로 넘겨 복귀 대상을 고정한다.
    restoreFocusRef?: RefObject<HTMLElement | null> | undefined;
  },
): void {
  const { active, onClose, restoreFocusRef } = options;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    const trigger =
      restoreFocusRef?.current ??
      (document.activeElement as HTMLElement | null);

    function getFocusable(): HTMLElement[] {
      if (!container) return [];
      return Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
    }

    const focusable = getFocusable();
    (focusable[0] ?? container)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [active, containerRef]);
}

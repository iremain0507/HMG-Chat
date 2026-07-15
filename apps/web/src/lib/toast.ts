// lib/toast.ts — P10-T6-17 에러/신뢰(§19.5 D4): 앱레벨 토스트 이벤트 스토어.
//   Context provider 없이 어디서든(useSessionStream 의 error/재연결 실패 등) showToast() 로
//   알림을 올릴 수 있도록 모듈 단위 pub-sub 으로 구현 — components/layout/ToastContainer.tsx
//   가 subscribeToasts() 로 구독해 렌더한다.
export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let listeners: Listener[] = [];
let seq = 0;

function notify(): void {
  for (const listener of listeners) listener(toasts);
}

export function showToast(
  kind: ToastKind,
  message: string,
  durationMs = 4000,
): string {
  const id = `toast-${seq++}`;
  toasts = [...toasts, { id, kind, message }];
  notify();
  if (durationMs > 0) {
    setTimeout(() => dismissToast(id), durationMs);
  }
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

export function subscribeToasts(listener: Listener): () => void {
  listeners = [...listeners, listener];
  listener(toasts);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// 테스트 격리 전용 — 모듈이 vitest 파일 내 여러 테스트/컴포넌트 트리에서 공유되므로
// afterEach 에서 스토어를 초기 상태로 되돌린다.
export function __resetToastsForTest(): void {
  toasts = [];
  listeners = [];
  seq = 0;
}

"use client";

// components/layout/ToastContainer.tsx — P10-T6-17 토스트 시스템(§19.5 D4).
//   lib/toast.ts 스토어를 구독해 렌더하는 앱레벨 컨테이너. AppShell 에 1회 마운트.
import React, { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type ToastItem } from "../../lib/toast";

const KIND_STYLES: Record<ToastItem["kind"], string> = {
  info: "border-border bg-surface text-fg",
  success: "border-primary/30 bg-primary/10 text-primary",
  error: "border-accent/30 bg-accent/10 text-accent",
};

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div
      data-testid="toast-container"
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[var(--z-toast)] flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid={`toast-${t.kind}`}
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm shadow-md ${KIND_STYLES[t.kind]}`}
        >
          <span>{t.message}</span>
          <button
            type="button"
            aria-label="토스트 닫기"
            onClick={() => dismissToast(t.id)}
            className="text-xs opacity-70 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

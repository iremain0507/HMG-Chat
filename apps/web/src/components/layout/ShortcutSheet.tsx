"use client";

// components/layout/ShortcutSheet.tsx — TS-22#5(docs/UAT-TEST-PLAN.md) 키보드 단축키
// 발견성을 위한 도움말 오버레이. ⌘/ 로 열림, Esc·배경 클릭·닫기 버튼으로 닫힘.
import React, { useRef } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

const SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: "⌘K", label: "검색 / 세션 커맨드 팔레트" },
  { keys: "⌘N", label: "새 세션" },
  { keys: "⌘\\", label: "우측 컨텍스트 패널 토글" },
  { keys: "⌘B", label: "세션 사이드바 접기/펼치기" },
  { keys: "⌘/", label: "이 단축키 도움말 열기" },
  { keys: "Enter", label: "메시지 전송" },
  { keys: "Shift+Enter", label: "줄바꿈 (전송 안 함)" },
];

export function ShortcutSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: open, onClose });

  if (!open) return null;

  return (
    <div
      data-testid="shortcut-sheet-backdrop"
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="키보드 단축키"
        aria-modal="true"
        data-testid="shortcut-sheet"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">키보드 단축키</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            ✕
          </button>
        </div>

        <ul className="mt-3 space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li
              key={s.keys}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-fg-muted">{s.label}</span>
              <span className="rounded-sm border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] text-fg">
                {s.keys}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

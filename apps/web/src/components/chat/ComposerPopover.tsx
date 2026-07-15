"use client";

// components/chat/ComposerPopover.tsx — P10-T6-12 슬래시/멘션 공용 필터 팝오버.
//   ChatInput 이 트리거(/ 또는 @) 감지 후 필터된 항목 목록을 렌더, 클릭/키보드로 선택.
import React from "react";

export interface ComposerPopoverItem {
  id: string;
  label: string;
  badge?: string;
}

export function ComposerPopover({
  items,
  activeIndex,
  onSelect,
  onHover,
  label,
}: {
  items: ComposerPopoverItem[];
  activeIndex: number;
  onSelect: (item: ComposerPopoverItem) => void;
  onHover: (index: number) => void;
  label: string;
}) {
  if (items.length === 0) return null;

  return (
    <ul
      role="listbox"
      aria-label={label}
      data-testid="composer-popover"
      className="absolute bottom-full left-0 z-10 mb-1 max-h-56 w-64 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
    >
      {items.map((item, index) => (
        <li key={item.id} role="option" aria-selected={index === activeIndex}>
          <button
            type="button"
            data-testid={`composer-popover-item-${item.id}`}
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(item)}
            className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${
              index === activeIndex
                ? "bg-primary/10 text-fg"
                : "text-fg-muted hover:bg-bg"
            }`}
          >
            <span className="truncate">{item.label}</span>
            {item.badge && (
              <span className="flex-none text-xs text-fg-muted">
                {item.badge}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

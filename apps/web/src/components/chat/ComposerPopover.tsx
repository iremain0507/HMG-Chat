"use client";

// components/chat/ComposerPopover.tsx — P10-T6-12 슬래시/멘션 공용 필터 팝오버,
//   P13-T6-04 F05 핸드오프 정렬: 360px 폭 + 검색 헤더 + 카테고리 탭(전체/에이전트/도구/
//   커넥터/파일/지식) + 정책 배지(읽기 전용=neutral/승인 필요=warning) + 키보드 힌트 풋터.
//   P13-T6-15 F17 모바일: md 미만에서는 바텀시트(하단 고정 전폭·상단 그래버·딤 백드롭)로,
//   md 이상에서는 기존 도킹 팝오버로 렌더.
import React from "react";

export interface ComposerPopoverItem {
  id: string;
  label: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: "neutral" | "warning";
}

export interface ComposerPopoverCategory {
  id: string;
  label: string;
}

const BADGE_STYLE: Record<"neutral" | "warning", string> = {
  neutral: "border-border bg-surface text-fg-muted",
  warning: "border-warning bg-warning-soft text-warning-fg",
};

export function optionDomId(itemId: string): string {
  return `composer-popover-option-${itemId}`;
}

export function ComposerPopover({
  items,
  activeIndex,
  onSelect,
  onHover,
  label,
  query,
  categories,
  activeCategory,
  onCategoryChange,
  showFooterHints = false,
  onDismiss,
  panelRef,
}: {
  items: ComposerPopoverItem[];
  activeIndex: number;
  onSelect: (item: ComposerPopoverItem) => void;
  onHover: (index: number) => void;
  label: string;
  query?: string;
  categories?: ComposerPopoverCategory[];
  activeCategory?: string;
  onCategoryChange?: (id: string) => void;
  showFooterHints?: boolean;
  onDismiss?: () => void;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  if (items.length === 0) return null;

  return (
    <>
      {onDismiss && (
        <button
          type="button"
          aria-label="닫기"
          data-testid="composer-popover-backdrop"
          onClick={onDismiss}
          className="fixed inset-0 z-[var(--z-modal)] border-0 bg-fg/40 p-0 md:hidden"
        />
      )}
      <div
        ref={panelRef}
        data-testid="composer-popover"
        className="fixed inset-x-0 bottom-0 z-[var(--z-modal)] flex max-h-[75vh] w-full flex-col overflow-hidden rounded-t-[14px] border-t border-border bg-surface shadow-[0_12px_24px_rgba(0,0,0,0.10)] md:absolute md:inset-auto md:bottom-full md:left-0 md:z-10 md:mb-2 md:max-h-none md:w-[360px] md:rounded-[10px] md:border md:shadow-[0_4px_8px_rgba(0,0,0,0.08)]"
      >
        <span
          aria-hidden="true"
          data-testid="composer-popover-grabber"
          className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border md:hidden"
        />
        {query !== undefined && (
          <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-fg">
            <span aria-hidden="true" className="text-placeholder">
              ⌕
            </span>
            <span data-testid="composer-popover-query">
              {query}
              <span
                aria-hidden="true"
                className="ml-0.5 inline-block h-3.5 w-px motion-safe:animate-pulse bg-primary align-middle"
              />
            </span>
          </div>
        )}
        {categories && categories.length > 0 && (
          <div
            role="tablist"
            aria-label={`${label} 카테고리`}
            className="flex gap-1 border-b border-border px-2 pt-1.5"
          >
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={c.id === activeCategory}
                data-testid={`composer-popover-tab-${c.id}`}
                onClick={() => onCategoryChange?.(c.id)}
                className={`px-2 pb-2 text-xs font-medium transition-colors ${
                  c.id === activeCategory
                    ? "border-b-2 border-primary text-primary"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <ul
          role="listbox"
          aria-label={label}
          className="max-h-56 overflow-auto p-1"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={optionDomId(item.id)}
              role="option"
              aria-selected={index === activeIndex}
            >
              <button
                type="button"
                data-testid={`composer-popover-item-${item.id}`}
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(item)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left ${
                  index === activeIndex
                    ? "bg-primary-50 text-fg"
                    : "text-fg-muted hover:bg-bg"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.label}</span>
                  {item.subtitle && (
                    <span className="block truncate text-xs text-placeholder">
                      {item.subtitle}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span
                    className={`flex-none rounded-full border px-2 py-0.5 text-xs ${
                      BADGE_STYLE[item.badgeVariant ?? "neutral"]
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {showFooterHints && (
          <div className="flex gap-3 border-t border-border px-3 py-2 text-xs text-placeholder">
            <span>↑↓ 이동</span>
            <span>↵ 삽입</span>
            {categories && categories.length > 0 && <span>Tab 유형 전환</span>}
            <span>Esc 닫기</span>
          </div>
        )}
      </div>
    </>
  );
}

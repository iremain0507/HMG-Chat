"use client";

// components/chat/MemoryPanel.tsx — P10-T6-14 채팅 내 메모리 노출/토글.
//   "/memories" 슬래시 커맨드로 열리는 인라인 패널 — useMemories 로 전체 카테고리 목록을
//   불러와 표시하고, 핀 토글만 지원(생성/편집/삭제는 /settings/memories 전용 범위, MemoryManager.tsx).
import React from "react";
import { useMemories } from "../../hooks/useMemories";

export function MemoryPanel({ onClose }: { onClose: () => void }) {
  const { memories, loading, update } = useMemories();

  return (
    <section
      role="region"
      aria-label="메모리"
      data-testid="memory-panel"
      className="mx-auto mb-2 max-w-3xl rounded-xl border border-border bg-surface p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-fg">메모리</span>
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="grid h-6 w-6 place-items-center rounded-full text-fg-muted hover:bg-bg hover:text-fg"
        >
          ×
        </button>
      </div>
      {loading ? (
        <p className="mt-2 text-sm text-fg-muted">불러오는 중…</p>
      ) : memories.length === 0 ? (
        <p className="mt-2 text-sm text-fg-muted">저장된 메모리가 없습니다.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {memories.map((m) => (
            <li
              key={m.id}
              data-testid={`memory-item-${m.id}`}
              className="flex items-start justify-between gap-2 text-sm"
            >
              <span className="text-fg">
                {m.pinned ? "📌 " : ""}
                {m.content}
              </span>
              <button
                type="button"
                onClick={() => update(m.id, { pinned: !m.pinned })}
                className="flex-none text-xs text-fg-muted hover:text-fg"
              >
                {m.pinned ? "고정 해제" : "고정"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

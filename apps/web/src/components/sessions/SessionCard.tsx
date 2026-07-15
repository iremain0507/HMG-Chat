"use client";

// components/sessions/SessionCard.tsx — 19-UIUX-UPGRADE.md § P10-T6-02
// 세션 1건: 클릭 시 이동, 이름변경(인라인 편집 → PATCH), 삭제.
import React, { useState } from "react";
import type { SessionListItemDto } from "../../hooks/useSessions";

export interface SessionCardProps {
  session: SessionListItemDto;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}

export function SessionCard({
  session,
  onOpen,
  onRename,
  onDelete,
}: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title ?? "");
  const label = session.title ?? "(제목 없음)";

  function startEdit() {
    setDraft(session.title ?? "");
    setEditing(true);
  }

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    const title = draft.trim();
    if (title && title !== session.title) onRename(session.id, title);
    setEditing(false);
  }

  if (editing) {
    return (
      <form onSubmit={submitEdit} className="px-2 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-full rounded-md border border-primary bg-bg px-2 py-1 text-sm text-fg outline-none"
        />
      </form>
    );
  }

  return (
    <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-bg">
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        className="min-w-0 flex-1 truncate text-left text-sm text-fg"
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={`이름변경: ${label}`}
        onClick={startEdit}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-fg group-hover:block"
      >
        ✎
      </button>
      <button
        type="button"
        aria-label={`삭제: ${label}`}
        onClick={() => onDelete(session.id)}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-accent group-hover:block"
      >
        🗑
      </button>
    </div>
  );
}

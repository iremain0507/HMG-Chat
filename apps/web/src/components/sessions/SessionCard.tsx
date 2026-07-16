"use client";

// components/sessions/SessionCard.tsx — design-reference README §Screens/AppShell.
// 세션 1건: 클릭 시 이동, hover 시 이름변경(인라인 편집 → PATCH)·고정(로컬)·폴더 지정·삭제.
import React, { useState } from "react";
import { FolderInput, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type {
  SessionFolder,
  SessionListItemDto,
} from "../../hooks/useSessions";

export interface SessionCardProps {
  session: SessionListItemDto;
  pinned: boolean;
  folders: SessionFolder[];
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onAssignFolder: (id: string, folderId: string | null) => void;
}

export function SessionCard({
  session,
  pinned,
  folders,
  onOpen,
  onRename,
  onDelete,
  onTogglePin,
  onAssignFolder,
}: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title ?? "");
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
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
    <div
      data-testid={`session-card-${session.id}`}
      className="group relative flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-bg"
    >
      <button
        type="button"
        onClick={() => onOpen(session.id)}
        className="min-w-0 flex-1 truncate text-left text-sm text-fg"
      >
        {label}
      </button>
      <button
        type="button"
        aria-label={pinned ? `고정 해제: ${label}` : `고정: ${label}`}
        title={pinned ? `고정 해제: ${label}` : `고정: ${label}`}
        aria-pressed={pinned}
        onClick={() => onTogglePin(session.id)}
        className={`shrink-0 rounded p-1 text-xs group-hover:block ${
          pinned ? "block text-primary" : "hidden text-fg-muted hover:text-fg"
        }`}
      >
        {pinned ? (
          <PinOff size={12} strokeWidth={1.8} />
        ) : (
          <Pin size={12} strokeWidth={1.8} />
        )}
      </button>
      <button
        type="button"
        aria-label={`이름변경: ${label}`}
        title={`이름변경: ${label}`}
        onClick={startEdit}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-fg group-hover:block"
      >
        <Pencil size={12} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label={`폴더 지정: ${label}`}
        title={`폴더 지정: ${label}`}
        onClick={() => setFolderMenuOpen((prev) => !prev)}
        className={`shrink-0 rounded p-1 text-xs group-hover:block ${
          session.folderId
            ? "block text-primary"
            : "hidden text-fg-muted hover:text-fg"
        }`}
      >
        <FolderInput size={12} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label={`삭제: ${label}`}
        title={`삭제: ${label}`}
        onClick={() => onDelete(session.id)}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-accent group-hover:block"
      >
        <Trash2 size={12} strokeWidth={1.8} />
      </button>
      {folderMenuOpen && (
        <div
          data-testid={`folder-menu-${session.id}`}
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-[10px] border border-border bg-surface p-1 shadow-lg"
        >
          {folders.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-muted">폴더가 없습니다.</p>
          ) : (
            folders.map((folder) => (
              <button
                key={folder.id}
                type="button"
                onClick={() => {
                  onAssignFolder(session.id, folder.id);
                  setFolderMenuOpen(false);
                }}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
              >
                {folder.name}
              </button>
            ))
          )}
          {session.folderId && (
            <button
              type="button"
              onClick={() => {
                onAssignFolder(session.id, null);
                setFolderMenuOpen(false);
              }}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-muted hover:bg-bg"
            >
              폴더 해제
            </button>
          )}
        </div>
      )}
    </div>
  );
}

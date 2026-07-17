"use client";

// components/sessions/SessionCard.tsx — design-reference README §Screens/AppShell.
// 세션 1건: 클릭 시 이동, hover 시 이름변경(인라인 편집 → PATCH)·고정(로컬)·폴더 지정·삭제.
import React, { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FolderInput,
  Pencil,
  Pin,
  PinOff,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
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
  onAddTag: (id: string, tag: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  onArchive: (id: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
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
  onAddTag,
  onRemoveTag,
  onArchive,
  selectionMode = false,
  selected = false,
  onToggleSelect,
}: SessionCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.title ?? "");
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const label = session.title ?? "(제목 없음)";

  function submitNewTag(e: React.FormEvent) {
    e.preventDefault();
    const tag = tagDraft.trim();
    if (tag) onAddTag(session.id, tag);
    setTagDraft("");
    setTagMenuOpen(false);
  }

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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-wchat-session-id", session.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenuOpen((prev) => !prev);
      }}
      className="group relative flex flex-col gap-0.5 rounded-md px-2 py-1.5 hover:bg-bg"
    >
      <div className="flex items-center gap-1">
        {selectionMode && (
          <input
            type="checkbox"
            aria-label={`선택: ${label}`}
            checked={selected}
            onChange={() => onToggleSelect?.(session.id)}
            className="shrink-0 accent-primary"
          />
        )}
        <button
          type="button"
          onClick={() =>
            selectionMode ? onToggleSelect?.(session.id) : onOpen(session.id)
          }
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
          aria-label={`태그 지정: ${label}`}
          title={`태그 지정: ${label}`}
          onClick={() => setTagMenuOpen((prev) => !prev)}
          className={`shrink-0 rounded p-1 text-xs group-hover:block ${
            session.tags.length > 0
              ? "block text-primary"
              : "hidden text-fg-muted hover:text-fg"
          }`}
        >
          <TagIcon size={12} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          aria-label={session.archived ? `복원: ${label}` : `보관: ${label}`}
          title={session.archived ? `복원: ${label}` : `보관: ${label}`}
          onClick={() => onArchive(session.id)}
          className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-fg group-hover:block"
        >
          {session.archived ? (
            <ArchiveRestore size={12} strokeWidth={1.8} />
          ) : (
            <Archive size={12} strokeWidth={1.8} />
          )}
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
      </div>
      {session.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pl-1">
          {session.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] text-primary"
            >
              {tag}
              <button
                type="button"
                aria-label={`태그 제거: ${tag}`}
                title={`태그 제거: ${tag}`}
                onClick={() => onRemoveTag(session.id, tag)}
                className="hover:text-accent"
              >
                <X size={9} strokeWidth={1.8} />
              </button>
            </span>
          ))}
        </div>
      )}
      {tagMenuOpen && (
        <div
          data-testid={`tag-menu-${session.id}`}
          className="absolute right-0 top-full z-10 mt-1 w-40 rounded-[10px] border border-border bg-surface p-1 shadow-lg"
        >
          <form onSubmit={submitNewTag}>
            <input
              autoFocus
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setTagMenuOpen(false);
              }}
              placeholder="새 태그"
              className="w-full rounded-md border border-primary bg-bg px-2 py-1 text-sm text-fg outline-none"
            />
          </form>
        </div>
      )}
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
      {contextMenuOpen && (
        <div
          data-testid={`context-menu-${session.id}`}
          className="absolute right-0 top-full z-10 mt-1 w-36 rounded-[10px] border border-border bg-surface p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              setContextMenuOpen(false);
              setFolderMenuOpen(true);
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
          >
            이동
          </button>
          <button
            type="button"
            onClick={() => {
              onTogglePin(session.id);
              setContextMenuOpen(false);
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
          >
            {pinned ? "고정 해제" : "고정"}
          </button>
          <button
            type="button"
            onClick={() => {
              onArchive(session.id);
              setContextMenuOpen(false);
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-bg"
          >
            {session.archived ? "복원" : "보관"}
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete(session.id);
              setContextMenuOpen(false);
            }}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:text-accent hover:bg-bg"
          >
            삭제
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

// components/sessions/SessionList.tsx — design-reference README §Screens/AppShell.
// 세션 히스토리 사이드바: 새 세션(⌘N)+검색(⌘K)+폴더 그룹+고정→오늘→어제→이전 7일 날짜그룹+
// hover 이름변경/고정/폴더 지정/삭제.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import {
  useSessions,
  type SessionFolder,
  type SessionListItemDto,
} from "../../hooks/useSessions";
import { SessionCard } from "./SessionCard";

const DAY_MS = 24 * 60 * 60 * 1000;
const CMDK_EVENT = "wchat:cmdk";

interface DateGroup {
  label: string;
  sessions: SessionListItemDto[];
}

export function groupSessionsByDate(
  sessions: SessionListItemDto[],
  now: Date,
): DateGroup[] {
  const startOfToday = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );

  const buckets: Record<string, SessionListItemDto[]> = {
    고정: [],
    오늘: [],
    어제: [],
    "이전 7일": [],
    이전: [],
  };

  for (const session of sessions) {
    if (session.pinned) {
      buckets["고정"]?.push(session);
      continue;
    }
    const at = session.lastMessageAt ? new Date(session.lastMessageAt) : now;
    const startOfAt = Date.UTC(
      at.getUTCFullYear(),
      at.getUTCMonth(),
      at.getUTCDate(),
    );
    const diffDays = Math.floor((startOfToday - startOfAt) / DAY_MS);
    if (diffDays <= 0) buckets["오늘"]?.push(session);
    else if (diffDays === 1) buckets["어제"]?.push(session);
    else if (diffDays <= 7) buckets["이전 7일"]?.push(session);
    else buckets["이전"]?.push(session);
  }

  return Object.entries(buckets)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, sessions: items }));
}

export function partitionByFolder(
  sessions: SessionListItemDto[],
  folders: SessionFolder[],
): {
  byFolder: Map<string, SessionListItemDto[]>;
  unfoldered: SessionListItemDto[];
} {
  const folderIds = new Set(folders.map((f) => f.id));
  const byFolder = new Map<string, SessionListItemDto[]>();
  const unfoldered: SessionListItemDto[] = [];
  for (const session of sessions) {
    if (session.folderId && folderIds.has(session.folderId)) {
      const list = byFolder.get(session.folderId) ?? [];
      list.push(session);
      byFolder.set(session.folderId, list);
    } else {
      unfoldered.push(session);
    }
  }
  return { byFolder, unfoldered };
}

function FolderGroupHeader({
  folder,
  collapsed,
  onToggleCollapse,
  onRename,
  onDelete,
}: {
  folder: SessionFolder;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (name && name !== folder.name) onRename(name);
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
    <div className="group flex items-center gap-1 rounded-md px-2 py-1">
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={
          collapsed ? `펼치기: ${folder.name}` : `접기: ${folder.name}`
        }
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold text-fg-muted"
      >
        {collapsed ? (
          <ChevronRight size={12} strokeWidth={1.8} />
        ) : (
          <ChevronDown size={12} strokeWidth={1.8} />
        )}
        <span className="truncate">{folder.name}</span>
      </button>
      <button
        type="button"
        aria-label={`폴더 이름변경: ${folder.name}`}
        title={`폴더 이름변경: ${folder.name}`}
        onClick={() => {
          setDraft(folder.name);
          setEditing(true);
        }}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-fg group-hover:block"
      >
        <Pencil size={12} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        aria-label={`폴더 삭제: ${folder.name}`}
        title={`폴더 삭제: ${folder.name}`}
        onClick={onDelete}
        className="hidden shrink-0 rounded p-1 text-xs text-fg-muted hover:text-accent group-hover:block"
      >
        <Trash2 size={12} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function SessionList({ now }: { now?: Date } = {}) {
  const router = useRouter();
  const {
    sessions,
    loading,
    createSession,
    renameSession,
    deleteSession,
    togglePin,
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    assignFolder,
    addTag,
    removeTag,
  } = useSessions();
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  function toggleFolderCollapse(id: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitNewFolder() {
    const name = folderDraft.trim();
    if (name) await createFolder(name);
    setFolderDraft("");
    setFolderFormOpen(false);
  }

  async function handleNewSession() {
    const created = await createSession();
    if (created) router.push(`/chat/${created.id}`);
  }

  useEffect(() => {
    function onCmdk() {
      searchRef.current?.focus();
    }
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        void handleNewSession();
      }
    }
    window.addEventListener(CMDK_EVENT, onCmdk);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(CMDK_EVENT, onCmdk);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [createSession, router]);

  function handleTogglePin(id: string) {
    void togglePin(id);
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) for (const tag of s.tags) set.add(tag);
    return Array.from(set).sort();
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (q && !(s.title ?? "").toLowerCase().includes(q)) return false;
      if (tagFilter && !s.tags.includes(tagFilter)) return false;
      return true;
    });
  }, [sessions, query, tagFilter]);

  const { byFolder, unfoldered } = useMemo(
    () => partitionByFolder(filtered, folders),
    [filtered, folders],
  );

  const groups = useMemo(
    () => groupSessionsByDate(unfoldered, now ?? new Date()),
    [unfoldered, now],
  );

  function renderSessionCard(session: SessionListItemDto) {
    return (
      <SessionCard
        key={session.id}
        session={session}
        pinned={session.pinned}
        folders={folders}
        onOpen={(id) => router.push(`/chat/${id}`)}
        onRename={(id, title) => void renameSession(id, title)}
        onDelete={(id) => void deleteSession(id)}
        onTogglePin={handleTogglePin}
        onAssignFolder={(id, folderId) => void assignFolder(id, folderId)}
        onAddTag={(id, tag) => void addTag(id, tag)}
        onRemoveTag={(id, tag) => void removeTag(id, tag)}
      />
    );
  }

  return (
    <div className="flex h-full flex-col p-2">
      <button
        type="button"
        onClick={() => void handleNewSession()}
        className="flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-semibold text-primary-fg transition hover:opacity-90"
      >
        ＋ 새 대화
        <span
          aria-hidden="true"
          className="font-mono text-[10px] font-normal opacity-70"
        >
          ⌘N
        </span>
      </button>
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="세션 검색"
        aria-label="세션 검색"
        data-testid="session-search-input"
        className="mt-1 h-[30px] w-full shrink-0 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none placeholder:text-fg-muted"
      />
      {folderFormOpen ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitNewFolder();
          }}
          className="mt-1"
        >
          <input
            autoFocus
            value={folderDraft}
            onChange={(e) => setFolderDraft(e.target.value)}
            onBlur={() => void submitNewFolder()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setFolderFormOpen(false);
            }}
            placeholder="새 폴더 이름"
            className="h-[30px] w-full rounded-md border border-primary bg-bg px-2 text-sm text-fg outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setFolderFormOpen(true)}
          className="mt-1 h-[26px] shrink-0 rounded-md px-2 text-left text-xs text-fg-muted hover:bg-bg hover:text-fg"
        >
          ＋ 폴더
        </button>
      )}
      {allTags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 px-1">
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              aria-pressed={tagFilter === tag}
              onClick={() =>
                setTagFilter((prev) => (prev === tag ? null : tag))
              }
              className={`rounded-full border px-2 py-0.5 text-[11px] ${
                tagFilter === tag
                  ? "border-primary bg-primary-50 text-primary"
                  : "border-border text-fg-muted hover:bg-bg hover:text-fg"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
      <nav className="mt-1.5 flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-1 text-sm text-fg-muted">불러오는 중…</p>
        ) : (
          <>
            {folders.map((folder) => {
              const items = byFolder.get(folder.id) ?? [];
              if (query.trim() && items.length === 0) return null;
              const collapsed = collapsedFolders.has(folder.id);
              return (
                <div key={folder.id} className="mb-3">
                  <FolderGroupHeader
                    folder={folder}
                    collapsed={collapsed}
                    onToggleCollapse={() => toggleFolderCollapse(folder.id)}
                    onRename={(name) => void renameFolder(folder.id, name)}
                    onDelete={() => void deleteFolder(folder.id)}
                  />
                  {!collapsed && items.map(renderSessionCard)}
                </div>
              );
            })}
            {filtered.length === 0 ? (
              <p className="px-2 py-1 text-sm text-fg-muted">
                세션이 없습니다.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="mb-3">
                  <h3 className="px-2 py-1 text-xs font-semibold text-fg-muted">
                    {group.label}
                  </h3>
                  {group.sessions.map(renderSessionCard)}
                </div>
              ))
            )}
          </>
        )}
      </nav>
    </div>
  );
}

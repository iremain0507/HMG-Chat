"use client";

// components/sessions/SessionList.tsx — design-reference README §Screens/AppShell.
// 세션 히스토리 사이드바: 새 세션(⌘N)+검색(⌘K)+폴더 그룹+고정→오늘→어제→이전 7일 날짜그룹+
// hover 이름변경/고정/폴더 지정/삭제.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  MessageSquareText,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  useSessions,
  type SessionFolder,
  type SessionListItemDto,
} from "../../hooks/useSessions";
import {
  searchSessions,
  type SessionSearchResultDto,
} from "../../lib/sessionSearch";
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
  // folders 는 루트/중첩 여부와 무관하게 전체 폴더 목록이므로 folderIds 는 이미 모든 깊이의
  // 폴더 id 를 포함한다 — 세션이 중첩 폴더에 할당돼도 그대로 byFolder 에 잡힌다(P20-T1-06).
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

// P20-T1-06 — 중첩 폴더(parent_folder_id 계층) 트리 구성. parentFolderId 가 null/undefined 이거나
// 부모를 목록에서 찾을 수 없으면 루트로 취급한다(고아 방지).
export interface FolderNode {
  folder: SessionFolder;
  children: FolderNode[];
}

export function buildFolderTree(folders: SessionFolder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>();
  for (const folder of folders) {
    byId.set(folder.id, { folder, children: [] });
  }
  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = byId.get(folder.id);
    if (!node) continue;
    const parentNode = folder.parentFolderId
      ? byId.get(folder.parentFolderId)
      : undefined;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

const FOLDER_DND_TYPE = "application/x-wchat-folder-id";
const SESSION_DND_TYPE = "application/x-wchat-session-id";
const FOLDER_INDENT_PX = 12;
const FOLDER_BASE_PADDING_PX = 8;

function FolderGroupHeader({
  folder,
  depth,
  collapsed,
  onToggleCollapse,
  onRename,
  onEditSystemPrompt,
  onDelete,
  onDropSession,
  onDropFolder,
}: {
  folder: SessionFolder;
  depth: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
  onEditSystemPrompt: (systemPrompt: string | null) => void;
  onDelete: () => void;
  onDropSession: (sessionId: string) => void;
  onDropFolder: (folderId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  // P20-T1-03 — 폴더 스코프 시스템 프롬프트 편집(Open WebUI Folder System Prompt 참고).
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState(folder.systemPrompt ?? "");
  const [dragOver, setDragOver] = useState(false);

  function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (name && name !== folder.name) onRename(name);
    setEditing(false);
  }

  function submitPromptEdit() {
    const value = promptDraft.trim();
    const normalized = value.length > 0 ? value : null;
    if (normalized !== (folder.systemPrompt ?? null)) {
      onEditSystemPrompt(normalized);
    }
    setEditingPrompt(false);
  }

  const indentStyle = {
    paddingLeft: FOLDER_BASE_PADDING_PX + depth * FOLDER_INDENT_PX,
  };

  if (editing) {
    return (
      <form onSubmit={submitEdit} className="py-1 pr-2" style={indentStyle}>
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

  if (editingPrompt) {
    return (
      <div className="py-1 pr-2" style={indentStyle}>
        <textarea
          autoFocus
          aria-label={`폴더 시스템 프롬프트: ${folder.name}`}
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          onBlur={submitPromptEdit}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditingPrompt(false);
          }}
          placeholder="이 폴더의 모든 채팅에 적용할 시스템 프롬프트"
          rows={3}
          className="w-full resize-none rounded-md border border-primary bg-bg px-2 py-1 text-sm text-fg outline-none"
        />
      </div>
    );
  }

  return (
    <div
      data-testid={`folder-header-${folder.id}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FOLDER_DND_TYPE, folder.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        // 폴더 자체를 드래그해 다른 폴더 아래로 이동(P20-T1-06). dataTransfer.types 로 실제
        // 어떤 타입이 세팅됐는지 확인 후 분기 — 테스트 mock 의 getData 는 인자와 무관하게 값을
        // 반환하는 경우가 있어 types 존재 여부로 우선순위를 가른다.
        const types = e.dataTransfer.types
          ? Array.from(e.dataTransfer.types)
          : [];
        if (types.includes(FOLDER_DND_TYPE)) {
          const draggedFolderId = e.dataTransfer.getData(FOLDER_DND_TYPE);
          if (draggedFolderId && draggedFolderId !== folder.id) {
            onDropFolder(draggedFolderId);
          }
          return;
        }
        const sessionId = e.dataTransfer.getData(SESSION_DND_TYPE);
        if (sessionId) onDropSession(sessionId);
      }}
      style={{ ...indentStyle, cursor: "grab" }}
      className={`group flex items-center gap-1 rounded-md py-1 pr-2 ${
        dragOver ? "bg-primary-50" : ""
      }`}
    >
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
        aria-label={`폴더 프롬프트 편집: ${folder.name}`}
        title={`폴더 프롬프트 편집: ${folder.name}`}
        onClick={() => {
          setPromptDraft(folder.systemPrompt ?? "");
          setEditingPrompt(true);
        }}
        className={`hidden shrink-0 rounded p-1 text-xs group-hover:block ${
          folder.systemPrompt
            ? "text-primary hover:text-primary"
            : "text-fg-muted hover:text-fg"
        }`}
      >
        <MessageSquareText size={12} strokeWidth={1.8} />
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
    hasMore,
    loadMore,
    createSession,
    renameSession,
    deleteSession,
    togglePin,
    folders,
    createFolder,
    renameFolder,
    updateFolderSystemPrompt,
    deleteFolder,
    moveFolder,
    assignFolder,
    addTag,
    removeTag,
    archivedSessions,
    archivedLoading,
    loadArchived,
    archiveSession,
    bulkArchiveSessions,
    bulkDeleteSessions,
  } = useSessions();
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [folderFormOpen, setFolderFormOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [archivedView, setArchivedView] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contentMatches, setContentMatches] = useState<
    SessionSearchResultDto[]
  >([]);

  function toggleSelectionMode() {
    setSelectionMode((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkArchive() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await bulkArchiveSessions(ids);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await bulkDeleteSessions(ids);
    setSelectedIds(new Set());
    setSelectionMode(false);
  }

  function openArchivedView() {
    setArchivedView(true);
    void loadArchived();
  }

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

  useEffect(() => {
    if (archivedView || !hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadMore();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [archivedView, hasMore, loadMore, sessions.length]);

  useEffect(() => {
    const q = query.trim();
    if (!q || archivedView) {
      setContentMatches([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchSessions(q, controller.signal).then((results) => {
        if (results) setContentMatches(results);
      });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, archivedView]);

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

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);

  const contentOnlyMatches = useMemo(() => {
    const shown = new Set(filtered.map((s) => s.id));
    return contentMatches.filter((r) => !shown.has(r.id));
  }, [contentMatches, filtered]);

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
        onArchive={(id) => void archiveSession(id)}
        selectionMode={selectionMode}
        selected={selectedIds.has(session.id)}
        onToggleSelect={toggleSelect}
      />
    );
  }

  function folderSubtreeHasItems(node: FolderNode): boolean {
    if ((byFolder.get(node.folder.id) ?? []).length > 0) return true;
    return node.children.some(folderSubtreeHasItems);
  }

  function renderFolderNode(node: FolderNode, depth: number): React.ReactNode {
    const { folder } = node;
    const items = byFolder.get(folder.id) ?? [];
    if (query.trim() && !folderSubtreeHasItems(node)) return null;
    const collapsed = collapsedFolders.has(folder.id);
    return (
      <div key={folder.id} className={depth === 0 ? "mb-3" : "mb-1"}>
        <FolderGroupHeader
          folder={folder}
          depth={depth}
          collapsed={collapsed}
          onToggleCollapse={() => toggleFolderCollapse(folder.id)}
          onRename={(name) => void renameFolder(folder.id, name)}
          onEditSystemPrompt={(systemPrompt) =>
            void updateFolderSystemPrompt(folder.id, systemPrompt)
          }
          onDelete={() => void deleteFolder(folder.id)}
          onDropSession={(sessionId) => void assignFolder(sessionId, folder.id)}
          onDropFolder={(draggedFolderId) => {
            if (draggedFolderId === folder.id) return;
            void moveFolder(draggedFolderId, folder.id);
          }}
        />
        {!collapsed && (
          <>
            {items.map(renderSessionCard)}
            {node.children.map((child) => renderFolderNode(child, depth + 1))}
          </>
        )}
      </div>
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
      <button
        type="button"
        aria-pressed={archivedView}
        onClick={() =>
          archivedView ? setArchivedView(false) : openArchivedView()
        }
        className={`mt-1 flex h-[26px] shrink-0 items-center gap-1 rounded-md px-2 text-left text-xs ${
          archivedView
            ? "bg-primary-50 text-primary"
            : "text-fg-muted hover:bg-bg hover:text-fg"
        }`}
      >
        <Archive size={12} strokeWidth={1.8} />
        보관함
      </button>
      {!archivedView && (
        <button
          type="button"
          aria-pressed={selectionMode}
          onClick={toggleSelectionMode}
          className={`mt-1 flex h-[26px] shrink-0 items-center gap-1 rounded-md px-2 text-left text-xs ${
            selectionMode
              ? "bg-primary-50 text-primary"
              : "text-fg-muted hover:bg-bg hover:text-fg"
          }`}
        >
          <CheckSquare size={12} strokeWidth={1.8} />
          다중 선택
        </button>
      )}
      {selectionMode && (
        <div className="mt-1 flex shrink-0 items-center gap-2 rounded-md bg-primary-50 px-2 py-1 text-xs text-primary">
          <span>{selectedIds.size}개 선택됨</span>
          <button
            type="button"
            onClick={() => void handleBulkArchive()}
            disabled={selectedIds.size === 0}
            className="rounded-md px-2 py-0.5 font-semibold hover:bg-bg disabled:opacity-40"
          >
            선택 항목 보관
          </button>
          <button
            type="button"
            onClick={() => void handleBulkDelete()}
            disabled={selectedIds.size === 0}
            className="rounded-md px-2 py-0.5 font-semibold text-accent hover:bg-bg disabled:opacity-40"
          >
            선택 항목 삭제
          </button>
        </div>
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
        {!archivedView && query.trim() && contentOnlyMatches.length > 0 ? (
          <div className="mb-3">
            <h3 className="px-2 py-1 text-xs font-semibold text-fg-muted">
              메시지 내용 검색결과
            </h3>
            {contentOnlyMatches.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => router.push(`/chat/${r.id}`)}
                data-testid={`content-match-${r.id}`}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-bg"
              >
                <span className="w-full truncate text-sm text-fg">
                  {r.title ?? "제목 없음"}
                </span>
                <span className="w-full truncate text-xs text-fg-muted">
                  {r.snippet ?? "메시지 내용이 일치합니다."}
                </span>
              </button>
            ))}
          </div>
        ) : null}
        {archivedView ? (
          archivedLoading ? (
            <p className="px-2 py-1 text-sm text-fg-muted">불러오는 중…</p>
          ) : archivedSessions.length === 0 ? (
            <p className="px-2 py-1 text-sm text-fg-muted">
              보관된 세션이 없습니다.
            </p>
          ) : (
            archivedSessions.map(renderSessionCard)
          )
        ) : loading ? (
          <p className="px-2 py-1 text-sm text-fg-muted">불러오는 중…</p>
        ) : (
          <>
            {folderTree.map((node) => renderFolderNode(node, 0))}
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
            {hasMore && (
              <div
                ref={sentinelRef}
                data-testid="session-list-sentinel"
                aria-hidden="true"
                className="h-1 w-full"
              />
            )}
          </>
        )}
      </nav>
    </div>
  );
}

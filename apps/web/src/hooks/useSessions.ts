"use client";

// hooks/useSessions.ts — 16-API-CONTRACT § GET/POST/PATCH/DELETE /sessions 소비.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";
import { toggleSessionArchive } from "../lib/archivedSessions";
import { toggleSessionPin } from "../lib/pinnedSessions";
import {
  assignSessionFolder,
  createFolder as createFolderApi,
  deleteFolder as deleteFolderApi,
  listFolders,
  moveFolder as moveFolderApi,
  renameFolder as renameFolderApi,
  updateFolderSystemPrompt as updateFolderSystemPromptApi,
  type SessionFolder,
} from "../lib/sessionFolders";
import { addSessionTag, removeSessionTag } from "../lib/sessionTags";
import { showToast } from "../lib/toast";

export type { SessionFolder } from "../lib/sessionFolders";

export interface SessionListItemDto {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  projectId: string | null;
  archived: boolean;
  pinned: boolean;
  folderId: string | null;
  tags: string[];
}

interface UseSessionsResult {
  sessions: SessionListItemDto[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  createSession: () => Promise<SessionListItemDto | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  folders: SessionFolder[];
  createFolder: (name: string) => Promise<SessionFolder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  updateFolderSystemPrompt: (
    id: string,
    systemPrompt: string | null,
  ) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  moveFolder: (id: string, parentFolderId: string | null) => Promise<void>;
  assignFolder: (id: string, folderId: string | null) => Promise<void>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
  archivedSessions: SessionListItemDto[];
  archivedLoading: boolean;
  loadArchived: () => Promise<void>;
  archiveSession: (id: string) => Promise<void>;
  bulkArchiveSessions: (ids: string[]) => Promise<void>;
  bulkDeleteSessions: (ids: string[]) => Promise<void>;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<SessionFolder[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<
    SessionListItemDto[]
  >([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/sessions", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("세션 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as {
        data: Array<
          SessionListItemDto & { folderId?: string | null; tags?: string[] }
        >;
        meta?: { nextCursor?: string };
      };
      setSessions(
        body.data.map((s) => ({
          ...s,
          folderId: s.folderId ?? null,
          tags: s.tags ?? [],
        })),
      );
      setCursor(body.meta?.nextCursor ?? null);
      setHasMore(Boolean(body.meta?.nextCursor));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const res = await apiFetch(
      `/api/v1/sessions?cursor=${encodeURIComponent(cursor)}`,
      { credentials: "include" },
    );
    if (!res.ok) {
      showToast("error", "세션 목록을 더 불러오지 못했습니다.");
      return;
    }
    const body = (await res.json()) as {
      data: Array<
        SessionListItemDto & { folderId?: string | null; tags?: string[] }
      >;
      meta?: { nextCursor?: string };
    };
    setSessions((prev) => [
      ...prev,
      ...body.data.map((s) => ({
        ...s,
        folderId: s.folderId ?? null,
        tags: s.tags ?? [],
      })),
    ]);
    setCursor(body.meta?.nextCursor ?? null);
    setHasMore(Boolean(body.meta?.nextCursor));
  }, [cursor]);

  const loadFolders = useCallback(async () => {
    const list = await listFolders();
    if (list) setFolders(list);
  }, []);

  useEffect(() => {
    void load();
    void loadFolders();
  }, [load, loadFolders]);

  const createSession = useCallback(async () => {
    const res = await apiFetch("/api/v1/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data: {
        id: string;
        title: string | null;
        projectId: string | null;
        createdAt: string;
      };
    };
    const created: SessionListItemDto = {
      id: body.data.id,
      title: body.data.title,
      projectId: body.data.projectId,
      lastMessageAt: body.data.createdAt,
      archived: false,
      pinned: false,
      folderId: null,
      tags: [],
    };
    setSessions((prev) => [created, ...prev]);
    return created;
  }, []);

  const renameSession = useCallback(async (id: string, title: string) => {
    const res = await apiFetch(`/api/v1/sessions/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) {
      showToast("error", "세션 이름을 변경하지 못했습니다.");
      return;
    }
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/v1/sessions/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 204) {
      showToast("error", "세션을 삭제하지 못했습니다.");
      return;
    }
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setArchivedSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const loadArchived = useCallback(async () => {
    setArchivedLoading(true);
    try {
      const res = await apiFetch("/api/v1/sessions?archived=true", {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        data: Array<
          SessionListItemDto & { folderId?: string | null; tags?: string[] }
        >;
      };
      setArchivedSessions(
        body.data.map((s) => ({
          ...s,
          folderId: s.folderId ?? null,
          tags: s.tags ?? [],
        })),
      );
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  const archiveSession = useCallback(async (id: string) => {
    const archived = await toggleSessionArchive(id);
    if (archived === null) {
      showToast("error", "세션 보관 처리에 실패했습니다.");
      return;
    }
    if (archived) {
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } else {
      setArchivedSessions((prev) => prev.filter((s) => s.id !== id));
    }
  }, []);

  const bulkArchiveSessions = useCallback(async (ids: string[]) => {
    const results = await Promise.all(
      ids.map((id) => toggleSessionArchive(id)),
    );
    const archivedIds = new Set(ids.filter((_, i) => results[i] === true));
    setSessions((prev) => prev.filter((s) => !archivedIds.has(s.id)));
    const failCount = ids.length - archivedIds.size;
    if (failCount > 0) {
      showToast("error", `${failCount}개 세션 보관에 실패했습니다.`);
    }
  }, []);

  const bulkDeleteSessions = useCallback(async (ids: string[]) => {
    const results = await Promise.all(
      ids.map(async (id) => {
        const res = await apiFetch(`/api/v1/sessions/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        return res.ok || res.status === 204;
      }),
    );
    const deletedIds = new Set(ids.filter((_, i) => results[i]));
    setSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
    setArchivedSessions((prev) => prev.filter((s) => !deletedIds.has(s.id)));
    const failCount = ids.length - deletedIds.size;
    if (failCount > 0) {
      showToast("error", `${failCount}개 세션 삭제에 실패했습니다.`);
    }
  }, []);

  const togglePin = useCallback(async (id: string) => {
    let previous = false;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        previous = s.pinned;
        return { ...s, pinned: !s.pinned };
      }),
    );
    const result = await toggleSessionPin(id);
    if (result === null) {
      showToast("error", "세션 고정 처리에 실패했습니다.");
    }
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, pinned: result === null ? previous : result } : s,
      ),
    );
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const created = await createFolderApi(name);
    if (!created) {
      showToast("error", "폴더를 생성하지 못했습니다.");
      return null;
    }
    setFolders((prev) => [...prev, created]);
    return created;
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const updated = await renameFolderApi(id, name);
    if (!updated) {
      showToast("error", "폴더 이름을 변경하지 못했습니다.");
      return;
    }
    setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
  }, []);

  const updateFolderSystemPrompt = useCallback(
    async (id: string, systemPrompt: string | null) => {
      const updated = await updateFolderSystemPromptApi(id, systemPrompt);
      if (!updated) {
        showToast("error", "폴더 프롬프트를 저장하지 못했습니다.");
        return;
      }
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    },
    [],
  );

  const deleteFolder = useCallback(async (id: string) => {
    const ok = await deleteFolderApi(id);
    if (!ok) {
      showToast("error", "폴더를 삭제하지 못했습니다.");
      return;
    }
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSessions((prev) =>
      prev.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
    );
  }, []);

  const moveFolder = useCallback(
    async (id: string, parentFolderId: string | null) => {
      const previous = folders.find((f) => f.id === id)?.parentFolderId ?? null;
      setFolders((prev) =>
        prev.map((f) => (f.id === id ? { ...f, parentFolderId } : f)),
      );
      const updated = await moveFolderApi(id, parentFolderId);
      if (!updated) {
        showToast("error", "폴더 이동에 실패했습니다.");
        setFolders((prev) =>
          prev.map((f) =>
            f.id === id ? { ...f, parentFolderId: previous } : f,
          ),
        );
        return;
      }
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    },
    [folders],
  );

  const assignFolder = useCallback(
    async (id: string, folderId: string | null) => {
      let previous: string | null = null;
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          previous = s.folderId;
          return { ...s, folderId };
        }),
      );
      const result = await assignSessionFolder(id, folderId);
      if (result === undefined) {
        showToast("error", "세션을 폴더에 배정하지 못했습니다.");
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, folderId: previous } : s)),
        );
      }
    },
    [],
  );

  const addTag = useCallback(async (id: string, tag: string) => {
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id && !s.tags.includes(tag)
          ? { ...s, tags: [...s.tags, tag] }
          : s,
      ),
    );
    const result = await addSessionTag(id, tag);
    if (result === undefined) {
      showToast("error", "태그를 추가하지 못했습니다.");
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, tags: s.tags.filter((t) => t !== tag) } : s,
        ),
      );
    }
  }, []);

  const removeTag = useCallback(async (id: string, tag: string) => {
    let previous: string[] = [];
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        previous = s.tags;
        return { ...s, tags: s.tags.filter((t) => t !== tag) };
      }),
    );
    const ok = await removeSessionTag(id, tag);
    if (!ok) {
      showToast("error", "태그를 삭제하지 못했습니다.");
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, tags: previous } : s)),
      );
    }
  }, []);

  return {
    sessions,
    loading,
    error,
    hasMore,
    loadMore,
    createSession,
    renameSession,
    deleteSession,
    togglePin,
    reload: load,
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
  };
}

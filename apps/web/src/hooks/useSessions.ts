"use client";

// hooks/useSessions.ts — 16-API-CONTRACT § GET/POST/PATCH/DELETE /sessions 소비.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";
import { toggleSessionPin } from "../lib/pinnedSessions";
import {
  assignSessionFolder,
  createFolder as createFolderApi,
  deleteFolder as deleteFolderApi,
  listFolders,
  renameFolder as renameFolderApi,
  type SessionFolder,
} from "../lib/sessionFolders";

export type { SessionFolder } from "../lib/sessionFolders";

export interface SessionListItemDto {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  projectId: string | null;
  archived: boolean;
  pinned: boolean;
  folderId: string | null;
}

interface UseSessionsResult {
  sessions: SessionListItemDto[];
  loading: boolean;
  error: string | null;
  createSession: () => Promise<SessionListItemDto | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  folders: SessionFolder[];
  createFolder: (name: string) => Promise<SessionFolder | null>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  assignFolder: (id: string, folderId: string | null) => Promise<void>;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [folders, setFolders] = useState<SessionFolder[]>([]);

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
        data: Array<SessionListItemDto & { folderId?: string | null }>;
      };
      setSessions(
        body.data.map((s) => ({ ...s, folderId: s.folderId ?? null })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

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
    if (!res.ok) return;
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  const deleteSession = useCallback(async (id: string) => {
    const res = await apiFetch(`/api/v1/sessions/${id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (!res.ok && res.status !== 204) return;
    setSessions((prev) => prev.filter((s) => s.id !== id));
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
    setSessions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, pinned: result === null ? previous : result } : s,
      ),
    );
  }, []);

  const createFolder = useCallback(async (name: string) => {
    const created = await createFolderApi(name);
    if (created) setFolders((prev) => [...prev, created]);
    return created;
  }, []);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const updated = await renameFolderApi(id, name);
    if (!updated) return;
    setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
  }, []);

  const deleteFolder = useCallback(async (id: string) => {
    const ok = await deleteFolderApi(id);
    if (!ok) return;
    setFolders((prev) => prev.filter((f) => f.id !== id));
    setSessions((prev) =>
      prev.map((s) => (s.folderId === id ? { ...s, folderId: null } : s)),
    );
  }, []);

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
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, folderId: previous } : s)),
        );
      }
    },
    [],
  );

  return {
    sessions,
    loading,
    error,
    createSession,
    renameSession,
    deleteSession,
    togglePin,
    reload: load,
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    assignFolder,
  };
}

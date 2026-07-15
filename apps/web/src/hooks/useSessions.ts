"use client";

// hooks/useSessions.ts — 16-API-CONTRACT § GET/POST/PATCH/DELETE /sessions 소비.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface SessionListItemDto {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  projectId: string | null;
  archived: boolean;
}

interface UseSessionsResult {
  sessions: SessionListItemDto[];
  loading: boolean;
  error: string | null;
  createSession: () => Promise<SessionListItemDto | null>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  reload: () => Promise<void>;
}

export function useSessions(): UseSessionsResult {
  const [sessions, setSessions] = useState<SessionListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/sessions", { credentials: "include" });
      if (!res.ok) {
        setError("세션 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: SessionListItemDto[] };
      setSessions(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  return {
    sessions,
    loading,
    error,
    createSession,
    renameSession,
    deleteSession,
    reload: load,
  };
}

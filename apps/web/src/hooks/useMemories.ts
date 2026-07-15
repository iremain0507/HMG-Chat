"use client";

// hooks/useMemories.ts — 16-API-CONTRACT § 9 Memories 소비 (CRUD + pin).
import { useCallback, useEffect, useState } from "react";

export interface UserMemoryDto {
  id: string;
  userId: string;
  category: "user" | "feedback" | "project" | "reference";
  content: string;
  source: "auto-extract" | "manual";
  sessionId: string | null;
  pinned: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

interface UseMemoriesResult {
  memories: UserMemoryDto[];
  loading: boolean;
  error: string | null;
  create(input: {
    category: UserMemoryDto["category"];
    content: string;
  }): Promise<void>;
  update(
    id: string,
    patch: {
      content?: string;
      pinned?: boolean;
      category?: UserMemoryDto["category"];
    },
  ): Promise<void>;
  remove(id: string): Promise<void>;
}

export function useMemories(
  category?: UserMemoryDto["category"],
): UseMemoriesResult {
  const [memories, setMemories] = useState<UserMemoryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = category ? `?category=${category}` : "";
      const res = await fetch(`/api/v1/memories${query}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("메모리 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: UserMemoryDto[] };
      setMemories(body.data);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: { category: UserMemoryDto["category"]; content: string }) => {
      setError(null);
      const res = await fetch("/api/v1/memories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "메모리 추가에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const update = useCallback(
    async (
      id: string,
      patch: {
        content?: string;
        pinned?: boolean;
        category?: UserMemoryDto["category"];
      },
    ) => {
      setError(null);
      const res = await fetch(`/api/v1/memories/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "메모리 수정에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/v1/memories/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("메모리 삭제에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  return { memories, loading, error, create, update, remove };
}

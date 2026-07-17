"use client";

// hooks/useGroups.ts — P19-T6-18: /api/v1/admin/groups(P19-T1-13) 소비.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface GroupDto {
  id: string;
  name: string;
  memberUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface UseGroupsResult {
  groups: GroupDto[];
  loading: boolean;
  error: string | null;
  createGroup(name: string): Promise<void>;
  renameGroup(id: string, name: string): Promise<void>;
  removeGroup(id: string): Promise<void>;
  addMember(id: string, userId: string): Promise<void>;
  removeMember(id: string, userId: string): Promise<void>;
}

export function useGroups(): UseGroupsResult {
  const [groups, setGroups] = useState<GroupDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/admin/groups", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("그룹 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: GroupDto[] };
      setGroups(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createGroup = useCallback(
    async (name: string) => {
      setError(null);
      const res = await apiFetch("/api/v1/admin/groups", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError("그룹 생성에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const renameGroup = useCallback(
    async (id: string, name: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/admin/groups/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError("그룹 이름 변경에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const removeGroup = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/admin/groups/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("그룹 삭제에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const addMember = useCallback(
    async (id: string, userId: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/admin/groups/${id}/members`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) {
        setError("멤버 추가에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const removeMember = useCallback(
    async (id: string, userId: string) => {
      setError(null);
      const res = await apiFetch(
        `/api/v1/admin/groups/${id}/members/${userId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        setError("멤버 제거에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  return {
    groups,
    loading,
    error,
    createGroup,
    renameGroup,
    removeGroup,
    addMember,
    removeMember,
  };
}

"use client";

// hooks/useAdminUsers.ts — 16-API-CONTRACT § 14 GET/PATCH /admin/users,
// POST /admin/users/:id/suspend|unsuspend 소비.
import { useCallback, useEffect, useState } from "react";

export interface AdminUserDto {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: "member" | "admin" | "owner";
  status: "active" | "suspended";
  lastLoginAt: string | null;
}

interface UseAdminUsersResult {
  users: AdminUserDto[];
  loading: boolean;
  error: string | null;
  changeRole(id: string, role: AdminUserDto["role"]): Promise<void>;
  suspend(id: string, reason: string): Promise<void>;
  unsuspend(id: string): Promise<void>;
}

export function useAdminUsers(): UseAdminUsersResult {
  const [users, setUsers] = useState<AdminUserDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/users", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("사용자 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AdminUserDto[] };
      setUsers(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRole = useCallback(
    async (id: string, role: AdminUserDto["role"]) => {
      setError(null);
      const res = await fetch(`/api/v1/admin/users/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        setError("역할 변경에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const suspend = useCallback(
    async (id: string, reason: string) => {
      setError(null);
      const res = await fetch(`/api/v1/admin/users/${id}/suspend`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setError("사용자 정지에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const unsuspend = useCallback(
    async (id: string) => {
      setError(null);
      const res = await fetch(`/api/v1/admin/users/${id}/unsuspend`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setError("정지 해제에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  return { users, loading, error, changeRole, suspend, unsuspend };
}

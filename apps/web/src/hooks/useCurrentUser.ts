"use client";

// hooks/useCurrentUser.ts — 16-API-CONTRACT § AuthMeResponse 소비. admin 화면 role 게이트용.
import { useEffect, useState } from "react";

export interface CurrentUserDto {
  id: string;
  email: string;
  name: string;
  orgId: string;
  role: "member" | "admin" | "owner";
  customInstructions: string | null;
  createdAt: string;
}

interface UseCurrentUserResult {
  user: CurrentUserDto | null;
  loading: boolean;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as { data: { user: CurrentUserDto } };
        if (!cancelled) setUser(body.data.user);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}

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

// P10-T6-13 — 모델/모드 피커가 org.allowedModels/allowedTools 로 가용 옵션을 가린다.
export interface CurrentOrgDto {
  id: string;
  name: string;
  domain: string;
  plan: string;
  allowedModels: string[];
  allowedTools: string[];
  defaultTokenBudgetMicros: number | null;
  createdAt: string;
  updatedAt: string;
}

interface UseCurrentUserResult {
  user: CurrentUserDto | null;
  org: CurrentOrgDto | null;
  loading: boolean;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<CurrentUserDto | null>(null);
  const [org, setOrg] = useState<CurrentOrgDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/v1/auth/me", { credentials: "include" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          data: { user: CurrentUserDto; org: CurrentOrgDto | null };
        };
        if (!cancelled) {
          setUser(body.data.user);
          setOrg(body.data.org);
        }
      } catch {
        // 네트워크 오류 시 user/org null 유지 — 아래 loading=false 로 전환만.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, org, loading };
}

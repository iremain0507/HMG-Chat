"use client";

// hooks/useAdminDashboard.ts — 16-API-CONTRACT § 14 GET /admin/dashboard 소비.
import { useCallback, useEffect, useState } from "react";

export interface AdminDashboardSummary {
  users: { total: number; activeLast24h: number; newLast7d: number };
  sessions: { total: number; activeNow: number; completedLast24h: number };
  errors: { last24h: number; last7d: number; critical: number };
  tools: { totalCalls24h: number; errorRate: number; p50LatencyMs: number };
}

interface UseAdminDashboardResult {
  summary: AdminDashboardSummary | null;
  loading: boolean;
  error: string | null;
}

export function useAdminDashboard(): UseAdminDashboardResult {
  const [summary, setSummary] = useState<AdminDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/dashboard", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("대시보드 정보를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AdminDashboardSummary };
      setSummary(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { summary, loading, error };
}

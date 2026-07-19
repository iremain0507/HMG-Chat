"use client";

// hooks/useAdminAnalytics.ts — P20-T1-15 소비: GET /api/v1/admin/analytics.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface ModelUsageRankingDto {
  model: string;
  messages: number;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
}

export interface MessageTimelineBucketDto {
  bucket: string;
  count: number;
}

export interface AdminAnalyticsDto {
  modelUsage: ModelUsageRankingDto[];
  timeline: MessageTimelineBucketDto[];
}

interface UseAdminAnalyticsResult {
  analytics: AdminAnalyticsDto | null;
  loading: boolean;
  error: string | null;
}

export function useAdminAnalytics(): UseAdminAnalyticsResult {
  const [analytics, setAnalytics] = useState<AdminAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/admin/analytics", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("분석 데이터를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AdminAnalyticsDto };
      setAnalytics(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { analytics, loading, error };
}

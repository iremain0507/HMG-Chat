"use client";

// hooks/useToolMetrics.ts — 16-API-CONTRACT § 14 GET /admin/tool-metrics 소비.
import { useCallback, useEffect, useState } from "react";

export interface ToolMetricDto {
  toolName: string;
  count: number;
  errorCount: number;
  errorRate: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  last24h: { count: number; errorRate: number };
}

interface UseToolMetricsResult {
  metrics: ToolMetricDto[];
  loading: boolean;
  error: string | null;
}

export function useToolMetrics(): UseToolMetricsResult {
  const [metrics, setMetrics] = useState<ToolMetricDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/tool-metrics", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("도구 통계를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: ToolMetricDto[] };
      setMetrics(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { metrics, loading, error };
}

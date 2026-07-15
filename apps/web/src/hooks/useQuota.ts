"use client";

// hooks/useQuota.ts — design-reference F14(사용량/쿼터) 소비.
//   16-API-CONTRACT § 12 GET /quota + GET /usage/me(둘 다 P9 에서 이미 마운트된 기존 라우트,
//   신규 라우트 없음). /usage/me 는 date 단위로만 집계되어 모델별 breakdown 은 계약에 없다
//   — QuotaPanel 은 합계만 렌더링한다(§ 09-TDD-GUIDE 정렬 원칙: 실 데이터만 표시).
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface QuotaInfo {
  budgetMicros: number;
  usedMicros: number;
  periodEnd: string;
}

export interface DailyUsageEntry {
  date: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
}

interface UseQuotaResult {
  quota: QuotaInfo | null;
  daily: DailyUsageEntry[];
  loading: boolean;
  error: string | null;
}

export function useQuota(): UseQuotaResult {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [daily, setDaily] = useState<DailyUsageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [quotaRes, usageRes] = await Promise.all([
          apiFetch("/api/v1/quota", { credentials: "include" }),
          apiFetch("/api/v1/usage/me", { credentials: "include" }),
        ]);
        if (!quotaRes.ok) {
          if (!cancelled) setError("사용량 정보를 불러오지 못했습니다.");
          return;
        }
        const quotaBody = (await quotaRes.json()) as { data: QuotaInfo };
        const usageBody = usageRes.ok
          ? ((await usageRes.json()) as { data: DailyUsageEntry[] })
          : { data: [] };
        if (!cancelled) {
          setQuota(quotaBody.data);
          setDaily(usageBody.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { quota, daily, loading, error };
}

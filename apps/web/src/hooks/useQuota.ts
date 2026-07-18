"use client";

// hooks/useQuota.ts — design-reference F14(사용량/쿼터) 소비.
//   16-API-CONTRACT § 12 GET /quota + GET /usage/me(둘 다 P9 에서 이미 마운트된 기존 라우트,
//   신규 라우트 없음). /usage/me 는 일별 집계 data 와 모델별 집계 byModel 을 함께 반환한다
//   (계약단위 C17(A), P22-T6-19). byModel 은 추가 필드라 구버전 서버 응답에서는 없을 수 있어
//   기본값 [] 로 방어한다(§ 09-TDD-GUIDE 정렬 원칙: 실 데이터만 표시).
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

export interface ModelUsageEntry {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
}

interface UseQuotaResult {
  quota: QuotaInfo | null;
  daily: DailyUsageEntry[];
  byModel: ModelUsageEntry[];
  loading: boolean;
  error: string | null;
}

export function useQuota(): UseQuotaResult {
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [daily, setDaily] = useState<DailyUsageEntry[]>([]);
  const [byModel, setByModel] = useState<ModelUsageEntry[]>([]);
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
          ? ((await usageRes.json()) as {
              data: DailyUsageEntry[];
              byModel?: ModelUsageEntry[];
            })
          : { data: [], byModel: [] };
        if (!cancelled) {
          setQuota(quotaBody.data);
          setDaily(usageBody.data ?? []);
          setByModel(usageBody.byModel ?? []);
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

  return { quota, daily, byModel, loading, error };
}

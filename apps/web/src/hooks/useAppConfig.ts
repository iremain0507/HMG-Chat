"use client";

// hooks/useAppConfig.ts — GET /api/v1/config 소비(P19-T1-10/T1-15 org_settings.banner typed 목록).
//   손상/미인증/네트워크 실패는 배너 빈 배열로 fail-soft(L2/L5) — 부트스트랩 실패로 앱 전체가
//   막히면 안 된다.
import { useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";
import type { AppBanner } from "../components/layout/Banner";

interface UseAppConfigResult {
  banner: AppBanner[];
  loading: boolean;
}

export function useAppConfig(): UseAppConfigResult {
  const [banner, setBanner] = useState<AppBanner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/api/v1/config");
        if (!res.ok) return;
        const body = (await res.json()) as { data: { banner?: AppBanner[] } };
        if (!cancelled) {
          setBanner(Array.isArray(body.data.banner) ? body.data.banner : []);
        }
      } catch {
        // 네트워크 오류 — 배너 미표시로 fail-soft, 앱 부트스트랩은 계속 진행.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { banner, loading };
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";
import type { AppBanner } from "../components/layout/Banner";

export interface AdminOrgSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  defaultModel: string;
  systemPrompt: string;
  toolMaxTokens: number;

  // 딥리서치(멀티에이전트) — 병렬 조사 폭·반성 횟수(deep-research-handler 가 org-scoped 로 읽음).
  deepResearchMaxSubQuestions: number;
  deepResearchMaxGapIterations: number;

  ragTopK: number;
  ragRrfK: number;
  ragChunkSizeTokens: number;
  ragChunkOverlapTokens: number;
  ragHybridEnabled: boolean;
  ragRelevanceThreshold: number;

  webSearchEnabled: boolean;
  webSearchResultCount: number;
  webSearchProvider: "dev-stub" | "tavily";
  webSearchEndpoint: string;
  webSearchApiKeyRef: string;

  // P22-T1-08 — image_generate 도구 org 게이트(Models & Generation 탭 토글). 서버 resolve 가
  // 항상 기본값(false)을 채워 내려주므로 실사용상 항상 존재하나, 기존 픽스처 비파괴 위해 optional.
  imageGenEnabled?: boolean;

  enableDirectConnections: boolean;

  // P22-T1-11(계약배치 C14) Identity/LDAP — 서버 resolve 가 기본값을 항상 채워 내려주지만
  // 기존 픽스처 비파괴 위해 optional(imageGenEnabled 와 동일 처리). IdentityLdapTab 이 소비.
  ldapEnabled?: boolean;
  ldapUrl?: string;
  ldapBindDn?: string;
  ldapBindPasswordRef?: string;
  ldapBaseDn?: string;
  ldapUserFilter?: string;
  ldapEmailAttribute?: string;
  ldapNameAttribute?: string;
  ldapGroupAttribute?: string;
  ldapGroupRoleMap?: Record<string, "member" | "admin" | "owner">;
  ldapTlsRejectUnauthorized?: boolean;

  instanceName: string;
  banner: AppBanner[];
  responseWatermark: string;

  defaultUserRole: "member" | "admin" | "owner";
  enableSignup: boolean;

  maxUploadSizeMb: number;
  maxUploadCount: number;
}

interface UseAdminSettingsResult {
  settings: AdminOrgSettings | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useAdminSettings(): UseAdminSettingsResult {
  const [settings, setSettings] = useState<AdminOrgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/admin/settings", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("설정을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AdminOrgSettings };
      setSettings(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { settings, loading, error, reload: load };
}

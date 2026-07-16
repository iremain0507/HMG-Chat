"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface AdminOrgSettings {
  maxTokens: number;
  temperature: number;
  topP: number;
  defaultModel: string;
  systemPrompt: string;
  toolMaxTokens: number;

  ragTopK: number;
  ragRrfK: number;
  ragChunkSizeTokens: number;
  ragChunkOverlapTokens: number;
  ragHybridEnabled: boolean;
  ragRelevanceThreshold: number;

  webSearchEnabled: boolean;
  webSearchResultCount: number;

  enableDirectConnections: boolean;

  instanceName: string;
  banner: string;
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

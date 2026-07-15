"use client";

// hooks/useSkills.ts — 16-API-CONTRACT § 11 Skills 소비 (GET /skills 목록).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface SkillSpecDto {
  id: string;
  name: string;
  version: string;
  description: string;
  triggers: string[];
  entryPoint: string;
  permissions: string;
  assets?: { filename: string; s3Key: string }[];
}

interface UseSkillsResult {
  skills: SkillSpecDto[];
  loading: boolean;
  error: string | null;
}

export function useSkills(): UseSkillsResult {
  const [skills, setSkills] = useState<SkillSpecDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/v1/skills", { credentials: "include" });
      if (!res.ok) {
        setError("스킬 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: SkillSpecDto[] };
      setSkills(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { skills, loading, error };
}

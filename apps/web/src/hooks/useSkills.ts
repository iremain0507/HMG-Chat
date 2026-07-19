"use client";

// hooks/useSkills.ts — 16-API-CONTRACT § 11 Skills 소비.
//   GET /skills 목록 + P22-T6-18(계약 C12) 사용자 작성 스킬 변이(POST/PATCH/DELETE).
//   기본(옵션 없음)은 주입 대상 목록 — 즉 enabled 인 것만. 관리 화면(SkillsManager)은
//   { includeDisabled: true } 로 비활성 항목까지 받아 토글을 되돌릴 수 있게 한다.
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
  /** 'builtin' 은 파일시스템 불변 — 토글/삭제 대상이 아니다. */
  source?: "builtin" | "user";
  enabled?: boolean;
  /** 사용자 스킬의 저장소 PK(uuid). 변이 경로의 :id. 빌트인은 없음. */
  skillId?: string;
}

interface UseSkillsOptions {
  includeDisabled?: boolean;
}

/** 변이 결과 — 실패하면 서버 메시지를 그대로 화면에 노출한다(계약 error.message). */
type MutationResult = { ok: true } | { ok: false; error: string };

interface UseSkillsResult {
  skills: SkillSpecDto[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  createSkill: (skillMd: string) => Promise<MutationResult>;
  setSkillEnabled: (
    skillId: string,
    enabled: boolean,
  ) => Promise<MutationResult>;
  deleteSkill: (skillId: string) => Promise<MutationResult>;
}

async function errorMessageOf(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function useSkills(options?: UseSkillsOptions): UseSkillsResult {
  const includeDisabled = options?.includeDisabled ?? false;
  const [skills, setSkills] = useState<SkillSpecDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = includeDisabled
        ? "/api/v1/skills?includeDisabled=true"
        : "/api/v1/skills";
      const res = await apiFetch(url, { credentials: "include" });
      if (!res.ok) {
        setError("스킬 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: SkillSpecDto[] };
      setSkills(body.data);
    } finally {
      setLoading(false);
    }
  }, [includeDisabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const createSkill = useCallback(
    async (skillMd: string): Promise<MutationResult> => {
      const res = await apiFetch("/api/v1/skills", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillMd }),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: await errorMessageOf(res, "스킬을 저장하지 못했습니다."),
        };
      }
      await load();
      return { ok: true };
    },
    [load],
  );

  const setSkillEnabled = useCallback(
    async (skillId: string, enabled: boolean): Promise<MutationResult> => {
      const res = await apiFetch(`/api/v1/skills/${skillId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        return {
          ok: false,
          error: await errorMessageOf(res, "스킬 상태를 바꾸지 못했습니다."),
        };
      }
      return { ok: true };
    },
    [],
  );

  const deleteSkill = useCallback(
    async (skillId: string): Promise<MutationResult> => {
      const res = await apiFetch(`/api/v1/skills/${skillId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        return {
          ok: false,
          error: await errorMessageOf(res, "스킬을 삭제하지 못했습니다."),
        };
      }
      return { ok: true };
    },
    [],
  );

  return {
    skills,
    loading,
    error,
    reload: load,
    createSkill,
    setSkillEnabled,
    deleteSkill,
  };
}

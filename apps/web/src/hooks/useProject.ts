"use client";

// hooks/useProject.ts — 16-API-CONTRACT § GET /projects/:id 소비.
// RLS 가 non-member 에게 row 를 숨기므로 서버는 private/team-다른org 모두 404 로 응답
// (existence leak 방지) — 훅은 이 두 케이스를 구분하지 않고 동일한 notFound 상태로 노출한다.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface ProjectDto {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "team" | "org";
  orgUnitId: string | null;
  ownerId: string;
  createdAt: string;
}

interface UseProjectResult {
  project: ProjectDto | null;
  loading: boolean;
  notFound: boolean;
  error: string | null;
}

export function useProject(projectId: string): UseProjectResult {
  const [project, setProject] = useState<ProjectDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setError(null);
    try {
      const res = await apiFetch(`/api/v1/projects/${projectId}`, {
        credentials: "include",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "프로젝트를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: ProjectDto };
      setProject(body.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { project, loading, notFound, error };
}

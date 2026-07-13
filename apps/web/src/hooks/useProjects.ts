"use client";

// hooks/useProjects.ts — 16-API-CONTRACT § GET /projects?cursor&limit&visibility 소비.
import { useEffect, useState } from "react";
import type { ProjectDto } from "./useProject";

interface UseProjectsResult {
  projects: ProjectDto[];
  loading: boolean;
  error: string | null;
}

export function useProjects(): UseProjectsResult {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/v1/projects", { credentials: "include" });
        if (!res.ok) {
          if (!cancelled) setError("프로젝트 목록을 불러오지 못했습니다.");
          return;
        }
        const body = (await res.json()) as { data: ProjectDto[] };
        if (!cancelled) setProjects(body.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { projects, loading, error };
}

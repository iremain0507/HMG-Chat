"use client";

// hooks/useSessionProject.ts — 16-API-CONTRACT § GET/PATCH /sessions/:id 소비(projectId 스코핑).
//   P10-T6-14 채팅 헤더 [Project ▾] 가 현재 세션의 projectId 를 읽고 전환한다.
import { useCallback, useEffect, useState } from "react";

interface UseSessionProjectResult {
  projectId: string | null;
  loading: boolean;
  setProject(projectId: string | null): Promise<void>;
}

export function useSessionProject(sessionId: string): UseSessionProjectResult {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as { data: { projectId: string | null } };
      setProjectId(body.data.projectId);
    } catch {
      // 네트워크 오류 시 projectId null 유지 — 아래 loading=false 로 전환만.
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const setProject = useCallback(
    async (nextProjectId: string | null) => {
      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: nextProjectId }),
        });
        if (!res.ok) return;
        setProjectId(nextProjectId);
      } catch {
        // 네트워크 오류 시 상태 변경 없이 무시.
      }
    },
    [sessionId],
  );

  return { projectId, loading, setProject };
}

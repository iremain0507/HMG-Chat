"use client";

// hooks/useAgents.ts — P22-T6-10 Agent registry(워크스페이스 커스텀 모델) 소비.
//   /api/v1/agents 계약: GET 목록 · POST 생성(409 CONFLICT=조직 내 이름 중복) ·
//   GET/:id · PATCH/:id 부분 수정 · DELETE/:id(204). useMcpServers 와 동일하게
//   변이 후 목록을 재조회해 서버 상태를 단일 출처로 유지한다.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface AgentDto {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  baseModel: string;
  systemPrompt: string | null;
  toolIds: string[];
  skillIds: string[];
  projectIds: string[];
  visibility: "private" | "org";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentInput {
  name: string;
  baseModel: string;
  description?: string | null;
  systemPrompt?: string | null;
  toolIds?: string[];
  skillIds?: string[];
  projectIds?: string[];
  visibility?: AgentDto["visibility"];
}

export type AgentPatch = Partial<AgentInput>;

interface UseAgentsResult {
  agents: AgentDto[];
  loading: boolean;
  error: string | null;
  create(input: AgentInput): Promise<void>;
  update(id: string, patch: AgentPatch): Promise<void>;
  remove(id: string): Promise<void>;
}

async function readErrorMessage(
  res: { json(): Promise<unknown> },
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function useAgents(): UseAgentsResult {
  const [agents, setAgents] = useState<AgentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/agents", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("에이전트 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AgentDto[] };
      setAgents(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: AgentInput) => {
      setError(null);
      const res = await apiFetch("/api/v1/agents", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "에이전트 생성에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const update = useCallback(
    async (id: string, patch: AgentPatch) => {
      setError(null);
      const res = await apiFetch(`/api/v1/agents/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "에이전트 수정에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/agents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "에이전트 삭제에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  return { agents, loading, error, create, update, remove };
}

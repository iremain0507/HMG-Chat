"use client";

// hooks/useMcpServers.ts — 16-API-CONTRACT § 10 MCP Servers 소비. POST 는 서버가 등록과
// 동시에 discovery(mcp-bridge)를 수행하고 그 결과(supportedTools)를 응답에 담는다.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface McpServerDto {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  url: string;
  transport: "streamable_http" | "sse";
  authHeaderName: string | null;
  authSecretArn: string | null;
  supportedTools: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
  lastDiscoveredAt: string | null;
  status: "active" | "degraded" | "suspended";
}

interface UseMcpServersResult {
  servers: McpServerDto[];
  loading: boolean;
  error: string | null;
  create(input: {
    name: string;
    url: string;
    transport: McpServerDto["transport"];
    scope?: { projectId?: string; userId?: string };
  }): Promise<void>;
  remove(id: string): Promise<void>;
}

export function useMcpServers(): UseMcpServersResult {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/mcp-servers", {
        credentials: "include",
      });
      if (!res.ok) {
        setError("MCP 서버 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: McpServerDto[] };
      setServers(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: {
      name: string;
      url: string;
      transport: McpServerDto["transport"];
      scope?: { projectId?: string; userId?: string };
    }) => {
      setError(null);
      const res = await apiFetch("/api/v1/mcp-servers", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "MCP 서버 등록에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/mcp-servers/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("MCP 서버 삭제에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  return { servers, loading, error, create, remove };
}

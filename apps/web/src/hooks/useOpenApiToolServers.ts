"use client";

// hooks/useOpenApiToolServers.ts — P22-T6-21. routes/openapi-tool-servers.ts(P22-T1-12) 소비.
//   useMcpServers 의 미러: POST 는 서버가 등록과 동시에 spec fetch·파싱(discovery)까지 수행하고
//   그 결과(supportedTools)를 응답에 담으므로 별도 폴링이 없다. 차이점은 (1) MCP url 대신
//   specUrl/baseUrl 2필드, (2) 등록 실패가 SSRF_BLOCKED/INVALID_SPEC 로 갈리므로 서버 message 를
//   그대로 표면화해야 사용자가 원인을 안다(내부망 차단 vs 스펙 파싱 실패).
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface OpenApiToolServerDto {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  specUrl: string;
  baseUrl: string;
  authHeaderName: string | null;
  authSecretArn: string | null;
  supportedTools: Array<{ name: string; description: string }>;
  lastDiscoveredAt: string | null;
  status: "active" | "degraded" | "suspended";
}

export interface UseOpenApiToolServersResult {
  servers: OpenApiToolServerDto[];
  loading: boolean;
  error: string | null;
  create(input: {
    name: string;
    specUrl: string;
    baseUrl?: string;
    scope?: { projectId?: string; userId?: string };
  }): Promise<boolean>;
  refresh(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const BASE = "/api/v1/openapi-tool-servers";

async function errorMessageOf(
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

export function useOpenApiToolServers(): UseOpenApiToolServersResult {
  const [servers, setServers] = useState<OpenApiToolServerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(BASE, { credentials: "include" });
      if (!res.ok) {
        setError("OpenAPI 툴서버 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: OpenApiToolServerDto[] };
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
      specUrl: string;
      baseUrl?: string;
      scope?: { projectId?: string; userId?: string };
    }): Promise<boolean> => {
      setError(null);
      const res = await apiFetch(BASE, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setError(
          await errorMessageOf(res, "OpenAPI 툴서버 등록에 실패했습니다."),
        );
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const refresh = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`${BASE}/${id}/refresh`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        setError(await errorMessageOf(res, "도구 재발견에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`${BASE}/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("OpenAPI 툴서버 삭제에 실패했습니다.");
        return;
      }
      await load();
    },
    [load],
  );

  return { servers, loading, error, create, refresh, remove };
}

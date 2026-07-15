// @vitest-environment jsdom
// hooks/useMcpServers.ts — 16-API-CONTRACT § 10 MCP Servers 소비 (POST 는 즉시 discovery).
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useMcpServers } from "../useMcpServers";

const SERVER_1 = {
  id: "srv-1",
  orgId: "org-1",
  projectId: null,
  userId: "user-1",
  name: "내부 도구 서버",
  url: "https://mcp.internal.example.com",
  transport: "streamable_http" as const,
  authHeaderName: null,
  authSecretArn: null,
  supportedTools: [],
  lastDiscoveredAt: null,
  status: "active" as const,
};

describe("useMcpServers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("서버 목록을 로드한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [SERVER_1] }),
      })),
    );

    const { result } = renderHook(() => useMcpServers());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.servers).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/mcp-servers",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("create 는 POST 후 discovery 결과를 포함해 목록을 재조회한다", async () => {
    const discovered = {
      ...SERVER_1,
      supportedTools: [
        { name: "search", description: "검색", inputSchema: {} },
      ],
      lastDiscoveredAt: "2026-07-13T00:00:00Z",
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, json: async () => ({ data: discovered }) };
        }
        return { ok: true, json: async () => ({ data: [discovered] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({
        name: "내부 도구 서버",
        url: "https://mcp.internal.example.com",
        transport: "streamable_http",
      });
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-servers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "내부 도구 서버",
          url: "https://mcp.internal.example.com",
          transport: "streamable_http",
        }),
      }),
    );
    expect(result.current.servers[0]?.supportedTools).toHaveLength(1);
  });

  it("remove 는 DELETE 후 목록을 재조회한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, status: 204, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("srv-1");
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/mcp-servers/srv-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(result.current.servers).toHaveLength(0);
  });

  it("create 실패 시 에러 메시지를 노출한다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return {
            ok: false,
            json: async () => ({ error: { message: "SSRF 차단됨" } }),
          };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMcpServers());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({
        name: "차단됨",
        url: "http://10.0.0.1",
        transport: "streamable_http",
      });
    });

    expect(result.current.error).toBe("SSRF 차단됨");
  });
});

// mcp/mcp-client-pool.ts — 14-INTERFACES.md § 8 McpClientPool 구현체.
// JSON-RPC 2.0 over HTTP 전송은 fetchImpl 로 주입(lib/office-pdf-converter.ts 와 동일 DI 패턴,
// 테스트에서 실 네트워크 미사용). invoke() 호출마다 01-LESSONS-LEARNED.md L16 quota 를
// 서버 단위 고정 윈도우 카운터로 강제 — 초과 시 WChatError(category:"rate-limit") throw.
import { randomUUID } from "node:crypto";
import {
  WChatError,
  type McpClient,
  type McpClientPool,
  type McpServerRecord,
} from "@wchat/interfaces";
import type { McpServerDataAccess } from "../db/mcp-server-data-access.js";
import {
  mcpResultToAgentToolResult,
  mcpToolToAgentToolSpec,
  type McpRawTool,
  type McpRawToolCallResult,
} from "./mcp-tool-adapter.js";

export interface McpRateLimitOptions {
  maxCalls: number;
  windowMs: number;
}

export interface McpClientPoolOptions {
  da: McpServerDataAccess;
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: McpRateLimitOptions;
}

const DEFAULT_RATE_LIMIT: McpRateLimitOptions = {
  maxCalls: 60,
  windowMs: 60_000,
};

function toMcpClient(server: McpServerRecord): McpClient {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    transport: server.transport,
    health:
      server.status === "active"
        ? "healthy"
        : server.status === "degraded"
          ? "degraded"
          : "down",
    lastDiscoveredAt: server.lastDiscoveredAt,
  };
}

async function callJsonRpc(
  fetchImpl: typeof fetch,
  server: McpServerRecord,
  method: string,
  params: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (server.authHeaderName && server.authSecretArn) {
    headers[server.authHeaderName] = server.authSecretArn;
  }
  const res = await fetchImpl(server.url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    throw new WChatError(
      "MCP_HTTP_ERROR",
      "mcp",
      true,
      `mcp server ${server.name} 가 ${res.status} 를 응답했습니다.`,
    );
  }
  const body = (await res.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (body.error) {
    throw new WChatError("MCP_RPC_ERROR", "mcp", false, body.error.message);
  }
  return body.result;
}

export function createMcpClientPool(opts: McpClientPoolOptions): McpClientPool {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => Date.now());
  const rateLimit = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateState = new Map<string, { count: number; windowStart: number }>();

  function checkRateLimit(serverId: string) {
    const t = now();
    const state = rateState.get(serverId);
    if (!state || t - state.windowStart >= rateLimit.windowMs) {
      rateState.set(serverId, { count: 1, windowStart: t });
      return;
    }
    if (state.count >= rateLimit.maxCalls) {
      throw new WChatError(
        "MCP_RATE_LIMIT_EXCEEDED",
        "rate-limit",
        true,
        `mcp server ${serverId} 호출 한도(${rateLimit.maxCalls}/${rateLimit.windowMs}ms) 초과`,
      );
    }
    state.count++;
  }

  return {
    async list(scope) {
      const page = await opts.da.mcpServers.list({
        orgId: scope.orgId,
        ...(scope.projectId !== undefined
          ? { projectId: scope.projectId }
          : {}),
      });
      return page.items
        .filter((s) => s.userId === null || s.userId === scope.userId)
        .map(toMcpClient);
    },

    async byId(id) {
      const server = await opts.da.mcpServers.byId(id);
      return server ? toMcpClient(server) : null;
    },

    async discover(serverId) {
      const server = await opts.da.mcpServers.byId(serverId);
      if (!server) return [];
      const result = (await callJsonRpc(
        fetchImpl,
        server,
        "tools/list",
        {},
      )) as {
        tools?: McpRawTool[];
      };
      return (result.tools ?? []).map((tool) =>
        mcpToolToAgentToolSpec(server.id, tool),
      );
    },

    async invoke(serverId, toolName, args, signal) {
      checkRateLimit(serverId);
      const toolCallId = randomUUID();
      const server = await opts.da.mcpServers.byId(serverId);
      if (!server) {
        return mcpResultToAgentToolResult(toolCallId, {
          isError: true,
          content: [
            {
              type: "text",
              text: `mcp server ${serverId} 를 찾을 수 없습니다.`,
            },
          ],
        });
      }
      const result = (await callJsonRpc(
        fetchImpl,
        server,
        "tools/call",
        { name: toolName, arguments: args },
        signal,
      )) as McpRawToolCallResult;
      return mcpResultToAgentToolResult(toolCallId, result);
    },
  };
}

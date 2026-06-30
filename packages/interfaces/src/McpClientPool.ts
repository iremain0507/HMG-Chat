// packages/interfaces/src/McpClientPool.ts
// § 8 — MCP 서버 풀 + 도구 발견.
// 본 파일은 types.ts (AgentToolSpec, AgentToolResult) 만 import.

import type { AgentToolResult, AgentToolSpec } from "./types.js";

export interface McpClient {
  id: string;
  name: string;
  url: string; // SSRF 통과한 URL (12절 § SSRF 알고리즘)
  transport: "streamable_http" | "sse";
  health: "healthy" | "degraded" | "down";
  lastDiscoveredAt: Date | null;
}

export interface McpClientPool {
  list(scope: {
    orgId: string;
    userId: string;
    projectId?: string;
  }): Promise<McpClient[]>;
  byId(id: string): Promise<McpClient | null>;
  discover(serverId: string): Promise<AgentToolSpec[]>;
  invoke(
    serverId: string,
    toolName: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<AgentToolResult>;
}

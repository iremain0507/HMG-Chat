// mcp/mcp-tool-adapter.ts — MCP JSON-RPC(tools/list, tools/call) 원시 응답을
// 14-INTERFACES.md § 1,7 AgentToolSpec / AgentToolResult 로 변환하는 순수 어댑터.
// mcp-client-pool.ts(discover/invoke) 가 사용. namespaced tool name(mcp:{serverId}:{toolName})
// 으로 서로 다른 MCP 서버의 동명 도구가 orchestrator 도구 레지스트리에서 충돌하지 않게 한다.
import {
  WChatError,
  type AgentToolResult,
  type AgentToolSpec,
  type JsonSchema,
} from "@wchat/interfaces";

export interface McpRawTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp:${serverId}:${toolName}`;
}

export function mcpToolToAgentToolSpec(
  serverId: string,
  tool: McpRawTool,
  previousDescription?: string,
): AgentToolSpec {
  const description = tool.description ?? tool.name;
  // rug-pull 방어(20-MULTI-AGENT-TOOL.md §20.5 P11-T1-02): 이전 discover 시점과
  // description 이 달라지면 tags 로 표시 — orchestrator/HITL UI 가 재승인 신호로 사용.
  const descriptionChanged =
    previousDescription !== undefined && previousDescription !== description;
  return {
    name: mcpToolName(serverId, tool.name),
    description,
    inputSchema: tool.inputSchema ?? { type: "object" },
    permissionTier: "tool",
    defaultPolicy: "hitl",
    ...(descriptionChanged ? { tags: ["description-changed"] } : {}),
  };
}

export interface McpRawContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpRawToolCallResult {
  content?: McpRawContentBlock[];
  isError?: boolean;
}

export function mcpResultToAgentToolResult(
  toolCallId: string,
  result: McpRawToolCallResult,
): AgentToolResult {
  const text = (result.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");

  if (result.isError) {
    return {
      toolCallId,
      content: {
        kind: "error",
        error: new WChatError(
          "MCP_TOOL_ERROR",
          "mcp",
          false,
          text || "MCP 도구 호출 실패",
        ),
      },
    };
  }

  return { toolCallId, content: { kind: "text", text } };
}

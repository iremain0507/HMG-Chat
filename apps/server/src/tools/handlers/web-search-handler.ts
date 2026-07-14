// web-search-handler.ts — web_search AgentTool: WebSearchPort(Tavily 실구현/dev-stub) 를 감싸
//   query 를 검색해 title/url/content 목록을 tool_result json 으로 반환한다.
//   defaultPolicy allow(부작용 없음) + tags read-only/idempotent/web
//   (20-MULTI-AGENT-TOOL.md §20.4-3 — 역량 메타는 tags 로 인코딩, 전용 필드 신설 금지).
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, AgentToolSpec } from "@wchat/interfaces";
import type { WebSearchPort } from "../web-search-port.js";

export const webSearchToolSpec: AgentToolSpec = {
  name: "web_search",
  description:
    "웹에서 최신 정보를 검색해 제목/URL/요약이 포함된 결과 목록을 반환한다.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      maxResults: { type: "integer" },
    },
    required: ["query"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent", "web"],
};

export interface WebSearchToolDeps {
  port: WebSearchPort;
  maxResults?: number;
}

export function createWebSearchTool(deps: WebSearchToolDeps): AgentTool {
  return {
    spec: webSearchToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "query 가 필요합니다.",
            ),
          },
        };
      }
      const maxResults =
        typeof args.maxResults === "number"
          ? args.maxResults
          : (deps.maxResults ?? 5);

      try {
        const results = await deps.port.search(query, {
          maxResults,
          signal: ctx.signal,
        });
        return {
          toolCallId,
          content: { kind: "json", data: { query, results } },
        };
      } catch (err) {
        if (ctx.signal.aborted) {
          throw err;
        }
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "WEB_SEARCH_FAILED",
              "tool",
              true,
              "웹 검색에 실패했습니다.",
              err,
            ),
          },
        };
      }
    },
  };
}

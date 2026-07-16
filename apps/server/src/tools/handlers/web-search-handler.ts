// web-search-handler.ts — web_search AgentTool: WebSearchPort(Tavily 실구현/dev-stub) 를 감싸
//   query 를 검색해 title/url/content 목록을 tool_result json 으로 반환한다.
//   defaultPolicy allow(부작용 없음) + tags read-only/idempotent/web
//   (20-MULTI-AGENT-TOOL.md §20.4-3 — 역량 메타는 tags 로 인코딩, 전용 필드 신설 금지).
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, AgentToolSpec, ToolContext } from "@wchat/interfaces";
import type { WebSearchPort, WebSearchResultItem } from "../web-search-port.js";
import type { Citation } from "../../knowledge/citation-helper.js";
import type { ResolvedOrgSettings } from "../../lib/org-settings-schema.js";

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

// P19-T1-12 — org-scoped 웹검색 provider 동적 조회 포트. settings-service.ts(P14)의
// SettingsService.resolve 와 구조적으로 호환되는 최소 계약만 의존(DI, deep-research-handler.ts
// 의 ToolSettingsResolverPort 와 동일한 순환 회피 패턴 — orgId 로 resolve 해 필요한 필드만 pick).
export interface WebSearchSettingsResolverPort {
  resolve(
    orgId: string,
  ): Promise<
    Pick<
      ResolvedOrgSettings,
      "webSearchProvider" | "webSearchEndpoint" | "webSearchApiKeyRef"
    >
  >;
}

export interface WebSearchToolDeps {
  // settings/resolveProvider 미주입 또는 org provider 미해석(dev-stub/알 수 없음/구성 실패) 시
  // 폴백으로 쓰이는 기본 port(L2 fail-soft).
  port: WebSearchPort;
  maxResults?: number;
  // 주입 시 invoke 시점에 ctx.orgId 로 org 설정(webSearchProvider 등)을 동적 조회한다
  // (P15-T2-02 deep_research settings 와 동일한 invoke-time resolve 패턴, L1).
  settings?: WebSearchSettingsResolverPort;
  // resolve 된 provider/endpoint/apiKeyRef 로 실제 WebSearchPort 를 구성. provider 가
  // "dev-stub"/알 수 없는 값이거나 구성 실패(예: apiKeyRef 미인식)면 undefined 를 반환해
  // deps.port 폴백을 유도한다(L2 — throw 금지).
  resolveProvider?: (input: {
    provider?: string | undefined;
    endpoint?: string | undefined;
    apiKeyRef?: string | undefined;
  }) => WebSearchPort | undefined;
}

// settings/resolveProvider 미주입, org 미설정(dev-stub), resolve 실패는 전부 deps.port 로
// fail-soft 한다(L2/L5 — throw 금지, 조용한 실패 대신 logger.warn 으로 가시화).
async function resolveSearchPort(
  deps: WebSearchToolDeps,
  orgId: string,
  logger: ToolContext["logger"] | undefined,
): Promise<WebSearchPort> {
  if (!deps.settings || !deps.resolveProvider) return deps.port;
  try {
    const resolved = await deps.settings.resolve(orgId);
    const built = deps.resolveProvider({
      provider: resolved.webSearchProvider,
      endpoint: resolved.webSearchEndpoint,
      apiKeyRef: resolved.webSearchApiKeyRef,
    });
    return built ?? deps.port;
  } catch (error) {
    logger?.warn({
      category: "system",
      msg: "web_search: org 설정 provider resolve 실패 — 기본 provider 로 폴백",
      orgId,
      context: { error: String(error) },
    });
    return deps.port;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// citation.source 는 "project"|"ephemeral" 로 동결(packages/interfaces) —
// "web" 은 계약 변경이라 격리 대상(20-MULTI-AGENT-TOOL.md §20.4/92행). 웹 결과는
// "ephemeral"로 근사하고 sourceUri 로 실제 출처 URL 을 보존한다.
function buildWebCitations(results: WebSearchResultItem[]): Citation[] {
  return results.map((r, i) => ({
    index: i + 1,
    source: "ephemeral",
    filename: hostnameOf(r.url),
    title: r.title,
    sourceUri: r.url,
    snippet: r.content.slice(0, 200),
  }));
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
        const port = await resolveSearchPort(deps, ctx.orgId, ctx.logger);
        const results = await port.search(query, {
          maxResults,
          signal: ctx.signal,
        });
        return {
          toolCallId,
          content: {
            kind: "json",
            data: { query, results, citations: buildWebCitations(results) },
          },
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

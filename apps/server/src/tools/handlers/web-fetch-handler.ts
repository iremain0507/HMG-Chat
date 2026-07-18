// web-fetch-handler.ts — web_fetch AgentTool: '#'+URL 웹페이지 로더.
//   지정 URL 을 (1) validateMcpUrl 로 SSRF 검증(RFC-1918/링크로컬 차단 + DNS resolve)한 뒤
//   (2) HTTP GET(크기/시간 제한 + content-type 가드) 하고 (3) HTML 을 읽을 수 있는 본문 텍스트로
//   정제해 tool_result json {url,title,content} + Citation 으로 반환한다.
//   web-search-handler.ts(검색 결과 목록)와 달리 "특정 페이지 1건"을 가져와 대화에 주입한다.
//   defaultPolicy allow(read-only, 부작용 없음) + tags read-only/idempotent/web
//   (20-MULTI-AGENT-TOOL.md §20.4-3 — 역량 메타는 tags 로 인코딩).
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, AgentToolSpec } from "@wchat/interfaces";
import type { Citation } from "../../knowledge/citation-helper.js";
import {
  validateMcpUrl,
  McpUrlValidationError,
} from "../../mcp/url-validator.js";

export const webFetchToolSpec: AgentToolSpec = {
  name: "web_fetch",
  description:
    "지정한 URL 의 웹페이지를 가져와 제목과 정제된 본문 텍스트를 반환한다. 내부/사설 주소는 거부한다.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string" },
    },
    required: ["url"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent", "web"],
};

export interface WebFetchToolDeps {
  // SSRF 검증/HTTP GET 훅 — 미주입 시 실 DNS(node:dns) + 전역 fetch 사용.
  // 테스트는 resolveHostname/fetchImpl 을 주입해 네트워크 없이 SSRF·정제 경로를 단언한다.
  nodeEnv?: string;
  allowedCidrs?: string[];
  resolveHostname?: (hostname: string) => Promise<string[]>;
  fetchImpl?: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
  // 응답 본문 최대 길이(문자). 초과분은 잘라낸다(토큰/메모리 폭주 방지).
  maxContentChars?: number;
}

const DEFAULT_MAX_CONTENT_CHARS = 100_000;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// HTML → 읽을 수 있는 본문 텍스트. cheerio/readability 등 미지정 의존성 없이 최소 정제만:
//   script/style/noscript 블록 제거 → 태그 제거 → HTML 엔티티 일부 복원 → 공백 정규화.
function cleanHtmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutBlocks.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

function extractTitle(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return undefined;
  const title = cleanHtmlToText(match[1] ?? "");
  return title.length > 0 ? title : undefined;
}

export function createWebFetchTool(deps: WebFetchToolDeps = {}): AgentTool {
  const doFetch = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const maxContentChars = deps.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS;

  return {
    spec: webFetchToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
      if (!rawUrl) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "url 이 필요합니다.",
            ),
          },
        };
      }

      // (1) SSRF 검증 — 반드시 네트워크 이전. 실패 시 검증 코드 그대로 노출(INTERNAL_IP_FORBIDDEN 등).
      let validated;
      try {
        validated = await validateMcpUrl(rawUrl, {
          ...(deps.nodeEnv !== undefined ? { nodeEnv: deps.nodeEnv } : {}),
          ...(deps.allowedCidrs ? { allowedCidrs: deps.allowedCidrs } : {}),
          ...(deps.resolveHostname
            ? { resolveHostname: deps.resolveHostname }
            : {}),
        });
      } catch (err) {
        if (err instanceof McpUrlValidationError) {
          return {
            toolCallId,
            content: {
              kind: "error",
              error: new WChatError(err.code, "tool", false, err.message),
            },
          };
        }
        throw err;
      }

      const targetUrl = validated.url.toString();

      // (2) HTTP GET + content-type 가드 + (3) 정제.
      try {
        const res = await doFetch(targetUrl, { signal: ctx.signal });
        const contentType = res.headers.get("content-type") ?? "";
        if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          return {
            toolCallId,
            content: {
              kind: "error",
              error: new WChatError(
                "UNSUPPORTED_CONTENT_TYPE",
                "tool",
                false,
                `HTML 페이지만 가져올 수 있습니다: ${contentType || "unknown"}`,
              ),
            },
          };
        }
        const html = await res.text();
        const title = extractTitle(html) ?? hostnameOf(targetUrl);
        const content = cleanHtmlToText(html).slice(0, maxContentChars);
        const citation: Citation = {
          index: 1,
          source: "ephemeral",
          filename: hostnameOf(targetUrl),
          title,
          sourceUri: targetUrl,
          snippet: content.slice(0, 200),
        };
        return {
          toolCallId,
          content: {
            kind: "json",
            data: { url: targetUrl, title, content, citations: [citation] },
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
              "WEB_FETCH_FAILED",
              "tool",
              true,
              "웹페이지를 가져오지 못했습니다.",
              err,
            ),
          },
        };
      }
    },
  };
}

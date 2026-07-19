// tools/openapi-tool-invoker.ts — 등록된 OpenAPI 툴서버의 endpoint 를 실제로 호출하는 실행기(P22-T1-12).
// openapi-tool-adapter.ts(순수 변환)와 분리: 여기만 네트워크 I/O 를 갖는다(테스트는 fetchImpl 주입).
// 보안: 호출 **직전에** mcp/url-validator.ts 로 base URL 을 다시 검증한다 — 등록 시점 검증만으로는
//   DNS rebinding(등록 후 같은 호스트가 내부 IP 로 재해석)을 막을 수 없기 때문(url-validator.ts 헤더 참조).
//   redirect: "error" 로 리다이렉트를 통한 내부 주소 재도달도 차단한다.
// 모든 실패는 throw 대신 AgentToolResult{kind:"error"} 로 정규화한다 — orchestrator 의 도구 루프가
//   한 도구 실패로 턴 전체를 잃지 않게 하기 위함(21-LOOP-LESSONS L5 fail-soft).
import { WChatError, type AgentToolResult } from "@wchat/interfaces";
import {
  buildOpenApiRequest,
  openApiResponseToAgentToolResult,
  type OpenApiOperation,
} from "./openapi-tool-adapter.js";
import { validateMcpUrl } from "../mcp/url-validator.js";

const INVOKE_TIMEOUT_MS = 30_000;

export interface OpenApiToolInvokerOptions {
  validateUrl?: typeof validateMcpUrl;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  nodeEnv?: string;
  allowedCidrs?: string[];
}

export interface OpenApiToolInvocation {
  toolCallId: string;
  baseUrl: string;
  operation: OpenApiOperation;
  args: Record<string, unknown>;
  authHeaderName: string | null;
  /** authSecretArn 로 조회한 실제 비밀값. 저장소에 평문이 없으므로 호출자가 해석해 넘긴다. */
  authSecret: string | null;
  signal?: AbortSignal;
}

function errorResult(
  toolCallId: string,
  code: string,
  message: string,
): AgentToolResult {
  return {
    toolCallId,
    content: {
      kind: "error",
      error: new WChatError(code, "tool", false, message),
    },
  };
}

export function createOpenApiToolInvoker(
  options: OpenApiToolInvokerOptions = {},
): (invocation: OpenApiToolInvocation) => Promise<AgentToolResult> {
  const validateUrl = options.validateUrl ?? validateMcpUrl;
  const fetchImpl = options.fetchImpl ?? fetch;
  const validatorOptions = {
    ...(options.nodeEnv !== undefined ? { nodeEnv: options.nodeEnv } : {}),
    ...(options.allowedCidrs !== undefined
      ? { allowedCidrs: options.allowedCidrs }
      : {}),
  };

  return async function invoke(inv) {
    try {
      await validateUrl(inv.baseUrl, validatorOptions);
    } catch (err) {
      return errorResult(
        inv.toolCallId,
        "SSRF_BLOCKED",
        err instanceof Error ? err.message : "base URL 검증 실패",
      );
    }

    let request: ReturnType<typeof buildOpenApiRequest>;
    try {
      request = buildOpenApiRequest(inv.baseUrl, inv.operation, inv.args);
    } catch (err) {
      return errorResult(
        inv.toolCallId,
        "INVALID_TOOL_ARGS",
        err instanceof Error ? err.message : "요청을 조립할 수 없습니다.",
      );
    }

    const headers: Record<string, string> = { ...request.headers };
    if (inv.authHeaderName && inv.authSecret) {
      headers[inv.authHeaderName] = inv.authSecret;
    }

    try {
      const res = await fetchImpl(request.url, {
        method: request.method,
        headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        redirect: "error",
        signal: inv.signal ?? AbortSignal.timeout(INVOKE_TIMEOUT_MS),
      });
      const bodyText = await res.text();
      return openApiResponseToAgentToolResult(inv.toolCallId, {
        status: res.status,
        ok: res.ok,
        bodyText,
      });
    } catch (err) {
      return errorResult(
        inv.toolCallId,
        "OPENAPI_TOOL_ERROR",
        err instanceof Error ? err.message : "endpoint 호출 실패",
      );
    }
  };
}

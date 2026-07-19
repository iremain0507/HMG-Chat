// tools/openapi-tool-assembler.ts — 등록된 OpenAPI 툴서버를 채팅 턴의 AgentTool[] 로 조립한다(P22-T1-12).
// app.ts 의 assembleOrgMcpTools 미러: org 소유 서버만 per-request 조회해 org 경계 밖 유출을 막는다
//   (list({orgId}) 필터가 그 경계 — 여기서 전역 조회를 하면 다른 org 의 endpoint 가 노출된다).
// 등록(routes/openapi-tool-servers.ts)·변환(openapi-tool-adapter.ts)·실행(openapi-tool-invoker.ts)을
//   잇는 마지막 배선. 이게 없으면 서버 등록은 되지만 모델이 호출할 수 없다.
// operations(같은 discover 시점의 method/path/parameters)를 spec 조립의 단일 출처로 쓴다 —
//   supportedTools 는 UI 표시용 캐시라 operation 메타가 없어 호출 요청을 조립할 수 없다.
import type { AgentTool } from "@wchat/interfaces";
import type { OpenApiToolServerDataAccess } from "../db/openapi-tool-server-data-access.js";
import { openApiOperationToAgentToolSpec } from "./openapi-tool-adapter.js";
import type { createOpenApiToolInvoker } from "./openapi-tool-invoker.js";

export interface OpenApiToolAssemblerDeps {
  da: OpenApiToolServerDataAccess;
  invoke: ReturnType<typeof createOpenApiToolInvoker>;
  /**
   * authSecretArn → 실제 비밀값. 저장소에 평문이 없으므로 조립 시점에 해석해 invoker 로 넘긴다.
   * 미주입이면 인증 헤더 없이 호출한다(공개 spec 용, dev 기본값).
   */
  resolveAuthSecret?: (arn: string) => Promise<string | null>;
}

export function assembleOrgOpenApiTools(deps: OpenApiToolAssemblerDeps) {
  return async (orgId: string): Promise<AgentTool[]> => {
    const page = await deps.da.openApiToolServers.list({ orgId });
    const tools: AgentTool[] = [];

    for (const server of page.items) {
      if (server.status !== "active") continue;
      for (const operation of server.operations) {
        tools.push({
          spec: openApiOperationToAgentToolSpec(server.id, operation),
          async invoke({ toolCallId, args, ctx }) {
            const authSecret =
              server.authSecretArn && deps.resolveAuthSecret
                ? await deps.resolveAuthSecret(server.authSecretArn)
                : null;
            return deps.invoke({
              toolCallId,
              baseUrl: server.baseUrl,
              operation,
              args,
              authHeaderName: server.authHeaderName,
              authSecret,
              ...(ctx.signal ? { signal: ctx.signal } : {}),
            });
          },
        });
      }
    }

    return tools;
  };
}

// tools/__tests__/openapi-tool-assembler.test.ts — P22-T1-12 acceptance #2
// ("모델이 등록된 endpoint 를 호출하면 SSRF 검증된 HTTP 요청이 나가고 AgentToolResult 가 돌아온다")
// 의 조립 계층. 등록(routes/openapi-tool-servers.ts)과 실행(tools/openapi-tool-invoker.ts)은
// 이미 있었으나 둘을 채팅 턴의 AgentTool[] 로 잇는 배선이 없어 "등록은 되지만 호출 불가" 상태였다.
import { describe, it, expect, vi } from "vitest";
import type { AgentToolResult } from "@wchat/interfaces";
import { assembleOrgOpenApiTools } from "../openapi-tool-assembler.js";
import type { OpenApiOperation } from "../openapi-tool-adapter.js";
import type {
  OpenApiToolServerDataAccess,
  OpenApiToolServerRecord,
} from "../../db/openapi-tool-server-data-access.js";

const getPet: OpenApiOperation = {
  operationId: "getPet",
  method: "get",
  path: "/pets/{petId}",
  description: "펫 조회",
  parameters: [
    {
      name: "petId",
      in: "path",
      required: true,
      schema: { type: "string" },
    },
  ],
  requestBodyRequired: false,
};

function serverRecord(
  over: Partial<OpenApiToolServerRecord> = {},
): OpenApiToolServerRecord {
  return {
    id: "srv-1",
    orgId: "org-1",
    projectId: null,
    userId: null,
    name: "petstore",
    specUrl: "https://petstore.example.com/openapi.json",
    baseUrl: "https://petstore.example.com",
    authHeaderName: null,
    authSecretArn: null,
    supportedTools: [],
    operations: [getPet],
    lastDiscoveredAt: new Date(),
    status: "active",
    ...over,
  };
}

function fakeDa(items: OpenApiToolServerRecord[]): OpenApiToolServerDataAccess {
  return {
    openApiToolServers: {
      insert: vi.fn(),
      byId: vi.fn(),
      list: vi.fn(async () => ({ items })),
      updateDiscovery: vi.fn(),
      delete: vi.fn(),
    } as unknown as OpenApiToolServerDataAccess["openApiToolServers"],
  };
}

const okResult = (toolCallId: string): AgentToolResult => ({
  toolCallId,
  content: { kind: "text", text: '{"name":"Rex"}' },
});

describe("assembleOrgOpenApiTools — P22-T1-12", () => {
  it("org 의 등록된 OpenAPI 서버 operation 을 namespaced AgentTool 로 조립한다", async () => {
    const invoke = vi.fn(async (inv) => okResult(inv.toolCallId));
    const tools = await assembleOrgOpenApiTools({
      da: fakeDa([serverRecord()]),
      invoke,
    })("org-1");

    expect(tools).toHaveLength(1);
    expect(tools[0].spec.name).toBe("openapi:srv-1:getPet");
    expect(tools[0].spec.inputSchema).toMatchObject({
      properties: { petId: { type: "string" } },
      required: ["petId"],
    });
  });

  it("조립된 tool.invoke 는 서버의 baseUrl/operation/auth 를 invoker 로 그대로 전달한다", async () => {
    const invoke = vi.fn(async (inv) => okResult(inv.toolCallId));
    const tools = await assembleOrgOpenApiTools({
      da: fakeDa([
        serverRecord({
          authHeaderName: "x-api-key",
          authSecretArn: "arn:secret:petstore",
        }),
      ]),
      invoke,
      resolveAuthSecret: async (arn) =>
        arn === "arn:secret:petstore" ? "s3cr3t" : null,
    })("org-1");

    const signal = new AbortController().signal;
    const result = await tools[0].invoke({
      toolCallId: "call-1",
      args: { petId: "42" },
      ctx: { signal } as never,
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0][0]).toMatchObject({
      toolCallId: "call-1",
      baseUrl: "https://petstore.example.com",
      args: { petId: "42" },
      authHeaderName: "x-api-key",
      authSecret: "s3cr3t",
      signal,
    });
    expect(invoke.mock.calls[0][0].operation.operationId).toBe("getPet");
    expect(result.content).toEqual({ kind: "text", text: '{"name":"Rex"}' });
  });

  it("disabled 서버의 operation 은 조립하지 않는다", async () => {
    const tools = await assembleOrgOpenApiTools({
      da: fakeDa([serverRecord({ status: "disabled" })]),
      invoke: vi.fn(),
    })("org-1");

    expect(tools).toEqual([]);
  });

  it("org 필터로만 조회한다(다른 org 서버 유출 방지)", async () => {
    const da = fakeDa([]);
    await assembleOrgOpenApiTools({ da, invoke: vi.fn() })("org-2");

    expect(da.openApiToolServers.list).toHaveBeenCalledWith({ orgId: "org-2" });
  });
});

// openapi-tool-invoker.test.ts — P22-T1-12 RED: tools/openapi-tool-invoker.ts 미존재.
// 갭 카탈로그 P22-T1-12 acceptance #2/#3 의 런타임 절반을 검증한다:
//   모델이 등록된 OpenAPI endpoint 를 호출하면 (a) 호출 직전 SSRF 재검증을 거치고
//   (b) AgentToolResult 로 정규화되며 (c) 검증 실패 시 실제 요청이 나가지 않는다.
// 등록 시점 검증만으로는 부족하다 — DNS rebinding 으로 등록 후 내부 IP 로 바뀔 수 있으므로
// 호출 시점에도 다시 검증한다(url-validator.ts 헤더의 rebinding 주의사항).
import { describe, it, expect } from "vitest";
import { createOpenApiToolInvoker } from "../openapi-tool-invoker.js";
import type { OpenApiOperation } from "../openapi-tool-adapter.js";
import { McpUrlValidationError } from "../../mcp/url-validator.js";

const LIST_PETS: OpenApiOperation = {
  operationId: "listPets",
  method: "get",
  path: "/pets",
  description: "펫 목록",
  parameters: [
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer" },
    },
  ],
  requestBodyRequired: false,
};

const CREATE_PET: OpenApiOperation = {
  operationId: "createPet",
  method: "post",
  path: "/pets",
  description: "펫 생성",
  parameters: [],
  requestBodySchema: { type: "object" },
  requestBodyRequired: true,
};

function okResponse(body: string, contentType = "application/json") {
  return new Response(body, {
    status: 200,
    headers: { "content-type": contentType },
  });
}

describe("createOpenApiToolInvoker", () => {
  it("SSRF 검증을 통과하면 조립된 요청을 실제로 보내고 JSON 결과를 반환한다", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => ({}) as never,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET" });
        return okResponse(JSON.stringify({ pets: [] }));
      },
    });

    const result = await invoke({
      toolCallId: "call-1",
      baseUrl: "https://api.example.com/v1",
      operation: LIST_PETS,
      args: { limit: 5 },
      authHeaderName: null,
      authSecret: null,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example.com/v1/pets?limit=5");
    expect(calls[0]?.method).toBe("GET");
    expect(result).toEqual({
      toolCallId: "call-1",
      content: { kind: "json", data: { pets: [] } },
    });
  });

  it("호출 직전 SSRF 검증이 실패하면 요청을 보내지 않고 error 결과를 반환한다", async () => {
    let fetched = 0;
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => {
        throw new McpUrlValidationError(
          "INTERNAL_IP_FORBIDDEN",
          "내부 IP 차단",
        );
      },
      fetchImpl: async () => {
        fetched++;
        return okResponse("{}");
      },
    });

    const result = await invoke({
      toolCallId: "call-2",
      baseUrl: "http://169.254.169.254",
      operation: LIST_PETS,
      args: {},
      authHeaderName: null,
      authSecret: null,
    });

    expect(fetched).toBe(0);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("SSRF_BLOCKED");
    }
  });

  it("authHeaderName/authSecret 이 있으면 인증 헤더를 붙인다", async () => {
    let seenHeaders: Record<string, string> = {};
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => ({}) as never,
      fetchImpl: async (_url, init) => {
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return okResponse("{}");
      },
    });

    await invoke({
      toolCallId: "call-3",
      baseUrl: "https://api.example.com/v1",
      operation: CREATE_PET,
      args: { body: { name: "코코" } },
      authHeaderName: "x-api-key",
      authSecret: "s3cr3t",
    });

    expect(seenHeaders["x-api-key"]).toBe("s3cr3t");
    expect(seenHeaders["content-type"]).toBe("application/json");
  });

  it("HTTP 오류 응답은 error kind 의 AgentToolResult 로 정규화된다", async () => {
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => ({}) as never,
      fetchImpl: async () =>
        new Response("nope", { status: 500, statusText: "Server Error" }),
    });

    const result = await invoke({
      toolCallId: "call-4",
      baseUrl: "https://api.example.com/v1",
      operation: LIST_PETS,
      args: {},
      authHeaderName: null,
      authSecret: null,
    });

    expect(result.content.kind).toBe("error");
  });

  it("필수 path 인자 누락 등 요청 조립 실패도 error 결과로 감싼다(throw 하지 않는다)", async () => {
    let fetched = 0;
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => ({}) as never,
      fetchImpl: async () => {
        fetched++;
        return okResponse("{}");
      },
    });

    const result = await invoke({
      toolCallId: "call-5",
      baseUrl: "https://api.example.com/v1",
      operation: {
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
      },
      args: {},
      authHeaderName: null,
      authSecret: null,
    });

    expect(fetched).toBe(0);
    expect(result.content.kind).toBe("error");
  });

  it("AbortSignal 을 fetch 로 전파한다(턴 취소 시 외부 호출도 끊긴다)", async () => {
    let seenSignal: AbortSignal | undefined;
    const invoke = createOpenApiToolInvoker({
      validateUrl: async () => ({}) as never,
      fetchImpl: async (_url, init) => {
        seenSignal = init?.signal ?? undefined;
        return okResponse("{}");
      },
    });
    const controller = new AbortController();

    await invoke({
      toolCallId: "call-6",
      baseUrl: "https://api.example.com/v1",
      operation: LIST_PETS,
      args: {},
      authHeaderName: null,
      authSecret: null,
      signal: controller.signal,
    });

    expect(seenSignal).toBe(controller.signal);
  });
});

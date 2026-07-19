import { describe, it, expect } from "vitest";
import { WChatError, type JsonSchema } from "@wchat/interfaces";
import {
  OpenApiInvocationError,
  OpenApiParseError,
  buildOpenApiRequest,
  openApiOperationToAgentToolSpec,
  openApiResponseToAgentToolResult,
  openApiToolName,
  parseOpenApiDocument,
  type OpenApiOperation,
} from "../openapi-tool-adapter.js";

const petStore = {
  openapi: "3.0.3",
  info: { title: "PetStore", version: "1.0.0" },
  components: {
    schemas: {
      Pet: {
        type: "object",
        properties: { id: { type: "integer" }, name: { type: "string" } },
        required: ["name"],
      },
      Node: {
        type: "object",
        properties: { next: { $ref: "#/components/schemas/Node" } },
      },
    },
  },
  paths: {
    "/pets/{petId}": {
      parameters: [
        {
          name: "petId",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "펫 ID",
        },
        {
          name: "trace",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      get: {
        operationId: "getPet",
        summary: "펫 조회",
        parameters: [
          // 동일 (name,in) — operation-level 이 path-level 을 이긴다.
          {
            name: "trace",
            in: "query",
            required: true,
            schema: { type: "boolean" },
          },
          {
            name: "sid",
            in: "cookie",
            required: true,
            schema: { type: "string" },
          },
        ],
      },
      delete: {
        // operationId 없음 → fallback
        description: "펫 삭제",
      },
    },
    "/pets": {
      post: {
        operationId: "createPet",
        description: "펫 생성",
        parameters: [
          {
            name: "x-req-id",
            in: "header",
            required: false,
            schema: { type: "string" },
          },
          {
            name: "tags",
            in: "query",
            required: false,
            schema: { type: "array" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Pet" },
            },
          },
        },
      },
      options: { operationId: "ignoredOptions" },
      summary: "컬렉션",
    },
    "/cycle": {
      put: {
        operationId: "cyclic",
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Node" },
            },
          },
        },
      },
    },
    "/broken": {
      patch: {
        operationId: "brokenRef",
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { $ref: "#/components/schemas/Nope" },
          },
        ],
      },
      get: "not-an-object",
    },
  },
};

function opOf(ops: OpenApiOperation[], id: string): OpenApiOperation {
  const found = ops.find((o) => o.operationId === id);
  if (!found) throw new Error(`operation ${id} not found`);
  return found;
}

describe("openApiToolName", () => {
  it("openapi:{serverId}:{operationId} 형태로 네임스페이스한다", () => {
    expect(openApiToolName("petstore", "getPet")).toBe(
      "openapi:petstore:getPet",
    );
  });
});

describe("parseOpenApiDocument — 유효성", () => {
  it("객체가 아닌 문서는 INVALID_SPEC 으로 throw 한다", () => {
    expect(() => parseOpenApiDocument("nope")).toThrow(OpenApiParseError);
    try {
      parseOpenApiDocument(null);
      expect.unreachable();
    } catch (e) {
      expect((e as OpenApiParseError).code).toBe("INVALID_SPEC");
    }
  });

  it("openapi 필드가 3.x 가 아니면 UNSUPPORTED_VERSION 으로 throw 한다", () => {
    try {
      parseOpenApiDocument({ swagger: "2.0", paths: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as OpenApiParseError).code).toBe("UNSUPPORTED_VERSION");
    }
    try {
      parseOpenApiDocument({ openapi: "2.0.1", paths: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as OpenApiParseError).code).toBe("UNSUPPORTED_VERSION");
    }
  });

  it("paths 가 없거나 객체가 아니면 INVALID_SPEC 으로 throw 한다", () => {
    try {
      parseOpenApiDocument({ openapi: "3.1.0" });
      expect.unreachable();
    } catch (e) {
      expect((e as OpenApiParseError).code).toBe("INVALID_SPEC");
    }
    expect(() => parseOpenApiDocument({ openapi: "3.1.0", paths: [] })).toThrow(
      OpenApiParseError,
    );
  });
});

describe("parseOpenApiDocument — 오퍼레이션 추출", () => {
  const ops = parseOpenApiDocument(petStore);

  it("get/post/put/patch/delete 만 수집하고 options 등은 무시한다", () => {
    expect(ops.map((o) => o.operationId).sort()).toEqual(
      [
        "brokenRef",
        "createPet",
        "cyclic",
        "delete_pets_petId",
        "getPet",
      ].sort(),
    );
  });

  it("operationId 가 없으면 method+path 로 결정론적 fallback 을 만든다", () => {
    const del = opOf(ops, "delete_pets_petId");
    expect(del.method).toBe("delete");
    expect(del.path).toBe("/pets/{petId}");
  });

  it("객체가 아닌 operation 엔트리는 throw 없이 건너뛴다", () => {
    expect(ops.some((o) => o.path === "/broken" && o.method === "get")).toBe(
      false,
    );
  });

  it("description → summary → '<METHOD> <path>' 순으로 설명을 고른다", () => {
    expect(opOf(ops, "getPet").description).toBe("펫 조회"); // summary fallback
    expect(opOf(ops, "createPet").description).toBe("펫 생성"); // description 우선
    expect(opOf(ops, "cyclic").description).toBe("PUT /cycle"); // 둘 다 없음
  });

  it("path-level 과 operation-level parameters 를 병합하고 동일 (name,in) 은 operation 이 이긴다", () => {
    const get = opOf(ops, "getPet");
    const trace = get.parameters.find((p) => p.name === "trace");
    expect(trace?.required).toBe(true);
    expect(trace?.schema).toEqual({ type: "boolean" });
    expect(get.parameters.find((p) => p.name === "petId")?.in).toBe("path");
  });

  it("path/query/header 이외의 in(cookie) 파라미터는 제외한다", () => {
    expect(opOf(ops, "getPet").parameters.some((p) => p.name === "sid")).toBe(
      false,
    );
  });

  it("requestBody 의 application/json 스키마와 required 를 추출하고 $ref 를 해석한다", () => {
    const post = opOf(ops, "createPet");
    expect(post.requestBodyRequired).toBe(true);
    expect(post.requestBodySchema?.properties?.name).toEqual({
      type: "string",
    });
    const del = opOf(ops, "delete_pets_petId");
    expect(del.requestBodySchema).toBeUndefined();
    expect(del.requestBodyRequired).toBe(false);
  });

  it("$ref 순환은 { type: 'object' } 로 안전하게 대체된다", () => {
    const cyc = opOf(ops, "cyclic");
    const next = cyc.requestBodySchema?.properties?.next;
    expect(next).toEqual({ type: "object" });
  });

  it("해석 불가한 $ref 도 { type: 'object' } 로 대체된다", () => {
    expect(opOf(ops, "brokenRef").parameters[0]?.schema).toEqual({
      type: "object",
    });
  });
});

describe("openApiOperationToAgentToolSpec", () => {
  const ops = parseOpenApiDocument(petStore);

  it("파라미터를 inputSchema properties 로 옮기고 required 를 채운다", () => {
    const spec = openApiOperationToAgentToolSpec(
      "petstore",
      opOf(ops, "getPet"),
    );
    expect(spec.name).toBe("openapi:petstore:getPet");
    expect(spec.description).toBe("펫 조회");
    expect(spec.inputSchema.type).toBe("object");
    expect(spec.inputSchema.additionalProperties).toBe(false);
    expect(spec.inputSchema.properties?.petId).toEqual({
      type: "string",
      description: "펫 ID",
    });
    expect(spec.inputSchema.required?.sort()).toEqual(["petId", "trace"]);
  });

  it("requestBody 가 있으면 body 프로퍼티를 추가하고 필수면 required 에 넣는다", () => {
    const spec = openApiOperationToAgentToolSpec(
      "petstore",
      opOf(ops, "createPet"),
    );
    expect(spec.inputSchema.properties?.body?.properties?.name).toEqual({
      type: "string",
    });
    expect(spec.inputSchema.required).toContain("body");
  });

  it("permissionTier=tool, defaultPolicy=hitl (HITL 기본)", () => {
    const spec = openApiOperationToAgentToolSpec(
      "petstore",
      opOf(ops, "createPet"),
    );
    expect(spec.permissionTier).toBe("tool");
    expect(spec.defaultPolicy).toBe("hitl");
  });

  it("schema 없는 파라미터는 { type: 'string' } 으로 기본값을 준다", () => {
    const op: OpenApiOperation = {
      operationId: "x",
      method: "get",
      path: "/x",
      description: "x",
      parameters: [{ name: "q", in: "query", required: false }],
      requestBodyRequired: false,
    };
    const spec = openApiOperationToAgentToolSpec("s", op);
    expect(spec.inputSchema.properties?.q).toEqual({ type: "string" });
    expect(spec.inputSchema.required).toEqual([]);
  });
});

describe("buildOpenApiRequest", () => {
  const ops = parseOpenApiDocument(petStore);

  it("path 파라미터를 치환하고 baseUrl 슬래시 중복을 만들지 않는다", () => {
    const req = buildOpenApiRequest(
      "https://api.example.com/",
      opOf(ops, "getPet"),
      {
        petId: "p 1",
        trace: true,
      },
    );
    expect(req.url).toBe("https://api.example.com/pets/p%201?trace=true");
    expect(req.method).toBe("GET");
    expect(req.body).toBeUndefined();
  });

  it("필수 path 인자가 없으면 MISSING_REQUIRED_ARG 로 throw 한다", () => {
    try {
      buildOpenApiRequest("https://api.example.com", opOf(ops, "getPet"), {});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OpenApiInvocationError);
      expect((e as OpenApiInvocationError).code).toBe("MISSING_REQUIRED_ARG");
    }
  });

  it("배열 query 값은 같은 키를 반복하고, undefined/null 은 생략한다", () => {
    const req = buildOpenApiRequest(
      "https://api.example.com",
      opOf(ops, "createPet"),
      {
        tags: ["a", "b"],
        unknown: null,
        body: { name: "n" },
      },
    );
    expect(req.url).toBe("https://api.example.com/pets?tags=a&tags=b");
  });

  it("header 파라미터는 headers 로, body 는 JSON 직렬화 + content-type 을 붙인다", () => {
    const req = buildOpenApiRequest(
      "https://api.example.com",
      opOf(ops, "createPet"),
      {
        "x-req-id": 42,
        body: { name: "hodu" },
      },
    );
    expect(req.headers["x-req-id"]).toBe("42");
    expect(req.headers["content-type"]).toBe("application/json");
    expect(req.body).toBe(JSON.stringify({ name: "hodu" }));
    expect(req.method).toBe("POST");
  });
});

describe("openApiResponseToAgentToolResult", () => {
  it("ok + JSON 본문 → kind=json", () => {
    const r = openApiResponseToAgentToolResult("tc1", {
      status: 200,
      ok: true,
      bodyText: '{"a":1}',
    });
    expect(r.toolCallId).toBe("tc1");
    expect(r.content).toEqual({ kind: "json", data: { a: 1 } });
  });

  it("ok + 비 JSON 본문 → kind=text", () => {
    const r = openApiResponseToAgentToolResult("tc2", {
      status: 200,
      ok: true,
      bodyText: "plain body",
    });
    expect(r.content).toEqual({ kind: "text", text: "plain body" });
  });

  it("non-ok → kind=error, WChatError(OPENAPI_TOOL_ERROR, retryable=false) + status/본문 포함", () => {
    const r = openApiResponseToAgentToolResult("tc3", {
      status: 503,
      ok: false,
      bodyText: "upstream down",
    });
    if (r.content.kind !== "error") throw new Error("expected error content");
    const err: WChatError = r.content.error;
    expect(err).toBeInstanceOf(WChatError);
    expect(err.code).toBe("OPENAPI_TOOL_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("503");
    expect(err.message).toContain("upstream down");
  });
});

describe("타입 sanity", () => {
  it("추출한 스키마는 JsonSchema 로 다룰 수 있다", () => {
    const ops = parseOpenApiDocument(petStore);
    const schema: JsonSchema | undefined = opOf(
      ops,
      "createPet",
    ).requestBodySchema;
    expect(schema?.type).toBe("object");
  });
});

// tools/openapi-tool-adapter.ts — 이미 파싱된 OpenAPI 3.x 문서(JSON object)를
// 14-INTERFACES.md § 1,7 AgentToolSpec / AgentToolResult 로 변환하는 순수 어댑터.
// namespaced tool name(openapi:{serverId}:{operationId}) 으로 서로 다른 OpenAPI 서버의
// 동명 operation 이 orchestrator 도구 레지스트리에서 충돌하지 않게 한다(mcp-tool-adapter.ts 미러).
// 범위 주의: YAML 스펙은 명시적으로 out of scope — 승인된 YAML 의존성이 없다(hard rule:
// 미지정 dependency 금지). 호출측이 JSON 으로 파싱해 넘긴 object 만 받는다.
// 기본 정책은 hitl (P22 gap catalog: 외부 HTTP 호출은 사람 승인 기본).
import {
  WChatError,
  type AgentToolResult,
  type AgentToolSpec,
  type JsonSchema,
} from "@wchat/interfaces";

// ─────────────────────────────────────────────────────────────────────────────
// 에러 타입 (mcp/url-validator.ts 의 McpUrlValidationError 패턴)
// ─────────────────────────────────────────────────────────────────────────────

export type OpenApiParseErrorCode = "INVALID_SPEC" | "UNSUPPORTED_VERSION";

export class OpenApiParseError extends Error {
  code: OpenApiParseErrorCode;
  constructor(code: OpenApiParseErrorCode, message: string) {
    super(message);
    this.name = "OpenApiParseError";
    this.code = code;
  }
}

export type OpenApiInvocationErrorCode = "MISSING_REQUIRED_ARG";

export class OpenApiInvocationError extends Error {
  code: OpenApiInvocationErrorCode;
  constructor(code: OpenApiInvocationErrorCode, message: string) {
    super(message);
    this.name = "OpenApiInvocationError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 모델
// ─────────────────────────────────────────────────────────────────────────────

export type OpenApiParameterLocation = "path" | "query" | "header";

export interface OpenApiParameter {
  name: string;
  in: OpenApiParameterLocation;
  required: boolean;
  schema?: JsonSchema;
  description?: string;
}

export interface OpenApiOperation {
  operationId: string;
  method: string;
  path: string;
  description: string;
  parameters: OpenApiParameter[];
  requestBodySchema?: JsonSchema;
  requestBodyRequired: boolean;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
const PARAM_LOCATIONS: OpenApiParameterLocation[] = ["path", "query", "header"];

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function openApiToolName(serverId: string, operationId: string): string {
  return `openapi:${serverId}:${operationId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// $ref 해석 — local `#/components/schemas/Name` 만. 순환/미해석은 { type: "object" }.
// ─────────────────────────────────────────────────────────────────────────────

function lookupRef(doc: JsonObject, ref: string): unknown {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) return undefined;
  const name = ref.slice(prefix.length);
  const components = doc["components"];
  if (!isObject(components)) return undefined;
  const schemas = components["schemas"];
  if (!isObject(schemas)) return undefined;
  return schemas[name];
}

function resolveSchema(
  node: unknown,
  doc: JsonObject,
  seen: ReadonlySet<string>,
): JsonSchema {
  if (!isObject(node)) return { type: "object" };

  const ref = node["$ref"];
  if (typeof ref === "string") {
    if (seen.has(ref)) return { type: "object" }; // 순환 방어
    const target = lookupRef(doc, ref);
    if (target === undefined) return { type: "object" }; // 미해석 ref
    return resolveSchema(target, doc, new Set([...seen, ref]));
  }

  const out: JsonObject = { ...node };

  const properties = node["properties"];
  if (isObject(properties)) {
    const resolved: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(properties)) {
      resolved[key] = resolveSchema(value, doc, seen);
    }
    out["properties"] = resolved;
  }

  const items = node["items"];
  if (Array.isArray(items)) {
    out["items"] = items.map((item) => resolveSchema(item, doc, seen));
  } else if (isObject(items)) {
    out["items"] = resolveSchema(items, doc, seen);
  }

  return out as JsonSchema;
}

// ─────────────────────────────────────────────────────────────────────────────
// 파싱
// ─────────────────────────────────────────────────────────────────────────────

function fallbackOperationId(method: string, path: string): string {
  return `${method} ${path}`
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseParameters(
  raw: unknown,
  doc: JsonObject,
): Map<string, OpenApiParameter> {
  const out = new Map<string, OpenApiParameter>();
  if (!Array.isArray(raw)) return out;
  for (const entry of raw) {
    if (!isObject(entry)) continue;
    const name = entry["name"];
    const location = entry["in"];
    if (typeof name !== "string" || name.length === 0) continue;
    if (
      typeof location !== "string" ||
      !PARAM_LOCATIONS.includes(location as OpenApiParameterLocation)
    ) {
      continue; // cookie 등은 무시
    }
    const schemaRaw = entry["schema"];
    const description = entry["description"];
    const param: OpenApiParameter = {
      name,
      in: location as OpenApiParameterLocation,
      required: entry["required"] === true,
      ...(schemaRaw !== undefined
        ? { schema: resolveSchema(schemaRaw, doc, new Set<string>()) }
        : {}),
      ...(typeof description === "string" ? { description } : {}),
    };
    out.set(`${param.in}:${param.name}`, param);
  }
  return out;
}

function parseRequestBody(
  raw: unknown,
  doc: JsonObject,
): { schema?: JsonSchema; required: boolean } {
  if (!isObject(raw)) return { required: false };
  const required = raw["required"] === true;
  const content = raw["content"];
  if (!isObject(content)) return { required };
  const json = content["application/json"];
  if (!isObject(json)) return { required };
  const schema = json["schema"];
  if (schema === undefined) return { required };
  return { schema: resolveSchema(schema, doc, new Set<string>()), required };
}

export function parseOpenApiDocument(doc: unknown): OpenApiOperation[] {
  if (!isObject(doc)) {
    throw new OpenApiParseError(
      "INVALID_SPEC",
      "OpenAPI 문서가 객체가 아닙니다(JSON object 만 지원 — YAML 미지원).",
    );
  }
  const version = doc["openapi"];
  if (typeof version !== "string" || !version.startsWith("3.")) {
    throw new OpenApiParseError(
      "UNSUPPORTED_VERSION",
      `지원하지 않는 OpenAPI 버전입니다: ${String(version)} (3.x 만 지원)`,
    );
  }
  const paths = doc["paths"];
  if (!isObject(paths)) {
    throw new OpenApiParseError(
      "INVALID_SPEC",
      "OpenAPI 문서에 paths 객체가 없습니다.",
    );
  }

  const operations: OpenApiOperation[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    const pathLevel = parseParameters(pathItem["parameters"], doc);

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!isObject(operation)) continue; // 비객체 엔트리는 skip (throw 하지 않음)

      // path-level ← operation-level 병합. 동일 (name,in) 은 operation 이 이긴다.
      const merged = new Map(pathLevel);
      for (const [key, param] of parseParameters(
        operation["parameters"],
        doc,
      )) {
        merged.set(key, param);
      }

      const rawId = operation["operationId"];
      const operationId =
        typeof rawId === "string" && rawId.length > 0
          ? rawId
          : fallbackOperationId(method, path);

      const description = operation["description"];
      const summary = operation["summary"];
      const body = parseRequestBody(operation["requestBody"], doc);

      operations.push({
        operationId,
        method,
        path,
        description:
          typeof description === "string"
            ? description
            : typeof summary === "string"
              ? summary
              : `${method.toUpperCase()} ${path}`,
        parameters: [...merged.values()],
        ...(body.schema !== undefined
          ? { requestBodySchema: body.schema }
          : {}),
        requestBodyRequired: body.required,
      });
    }
  }
  return operations;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentToolSpec 변환
// ─────────────────────────────────────────────────────────────────────────────

export function openApiOperationToAgentToolSpec(
  serverId: string,
  op: OpenApiOperation,
): AgentToolSpec {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const param of op.parameters) {
    const base: JsonSchema = param.schema ?? { type: "string" };
    properties[param.name] = {
      ...base,
      ...(param.description !== undefined && base.description === undefined
        ? { description: param.description }
        : {}),
    };
    if (param.required) required.push(param.name);
  }

  if (op.requestBodySchema !== undefined) {
    properties["body"] = op.requestBodySchema;
    if (op.requestBodyRequired) required.push("body");
  }

  return {
    name: openApiToolName(serverId, op.operationId),
    description: op.description,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    permissionTier: "tool",
    defaultPolicy: "hitl",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 호출 요청 조립
// ─────────────────────────────────────────────────────────────────────────────

export function buildOpenApiRequest(
  baseUrl: string,
  op: OpenApiOperation,
  args: Record<string, unknown>,
): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  let path = op.path;
  const headers: Record<string, string> = {};
  const query = new URLSearchParams();

  for (const param of op.parameters) {
    const value = args[param.name];
    if (param.in === "path") {
      if (value === undefined || value === null) {
        throw new OpenApiInvocationError(
          "MISSING_REQUIRED_ARG",
          `필수 path 파라미터가 없습니다: ${param.name} (${op.operationId})`,
        );
      }
      path = path.replaceAll(
        `{${param.name}}`,
        encodeURIComponent(String(value)),
      );
      continue;
    }
    if (value === undefined || value === null) continue;
    if (param.in === "header") {
      headers[param.name] = String(value);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        query.append(param.name, String(item));
      }
    } else {
      query.append(param.name, String(value));
    }
  }

  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  const search = query.toString();
  const url = `${base}${suffix}${search.length > 0 ? `?${search}` : ""}`;

  let body: string | undefined;
  if (args["body"] !== undefined) {
    body = JSON.stringify(args["body"]);
    headers["content-type"] = "application/json";
  }

  return {
    url,
    method: op.method.toUpperCase(),
    headers,
    ...(body !== undefined ? { body } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 응답 → AgentToolResult
// ─────────────────────────────────────────────────────────────────────────────

export function openApiResponseToAgentToolResult(
  toolCallId: string,
  res: { status: number; ok: boolean; bodyText: string },
): AgentToolResult {
  if (!res.ok) {
    const snippet = res.bodyText.slice(0, 500);
    return {
      toolCallId,
      content: {
        kind: "error",
        error: new WChatError(
          "OPENAPI_TOOL_ERROR",
          "tool",
          false,
          `OpenAPI 도구 호출 실패 (status ${res.status}): ${snippet}`,
        ),
      },
    };
  }

  try {
    return {
      toolCallId,
      content: { kind: "json", data: JSON.parse(res.bodyText) as unknown },
    };
  } catch {
    return { toolCallId, content: { kind: "text", text: res.bodyText } };
  }
}

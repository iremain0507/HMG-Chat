// routes/openapi-tool-servers.ts — P22-T1-12 (Open WebUI 파리티: OpenAPI 툴서버 인제스션).
// 계약 승인: .ralph/CONTRACT_APPROVED C13 — packages/interfaces 변경 없음(AgentToolSpec 으로 충분),
//   저장소 migration 0032_openapi_tool_servers.sql 만 신규.
// routes/mcp-servers.ts 의 미러 구조: db/openapi-tool-server-data-access.ts 는 RLS 를 superuser role
//   로 우회하므로 org 경계(다른 org 서버 접근 차단)는 이 라우트가 application 레벨에서 404 로 강제한다
//   (existence-leak 방지 패턴). spec URL 과 endpoint base URL **양쪽 모두** mcp/url-validator.ts
//   (SSRF, RFC-1918 차단 + VPC CIDR 화이트리스트)를 통과해야 등록된다 — 승인서 C13 의 필수 보안 조건.
// 범위: JSON OpenAPI 문서만(YAML 파서는 미승인 dependency — tools/openapi-tool-adapter.ts 헤더 참조).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AgentToolSpec } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type {
  OpenApiToolServerDataAccess,
  OpenApiToolServerRecord,
} from "../db/openapi-tool-server-data-access.js";
import { validateMcpUrl } from "../mcp/url-validator.js";
import {
  OpenApiParseError,
  openApiOperationToAgentToolSpec,
  parseOpenApiDocument,
  type OpenApiOperation,
} from "../tools/openapi-tool-adapter.js";
import type { ResourceGrantsDataAccess } from "../db/resource-grants-data-access.js";
import { filterAccessibleResourceIds } from "../lib/access-control.js";

const SPEC_FETCH_TIMEOUT_MS = 10_000;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(server: OpenApiToolServerRecord) {
  return {
    id: server.id,
    orgId: server.orgId,
    projectId: server.projectId,
    userId: server.userId,
    name: server.name,
    specUrl: server.specUrl,
    baseUrl: server.baseUrl,
    authHeaderName: server.authHeaderName,
    authSecretArn: server.authSecretArn,
    supportedTools: server.supportedTools,
    lastDiscoveredAt: server.lastDiscoveredAt
      ? server.lastDiscoveredAt.toISOString()
      : null,
    status: server.status,
  };
}

/** 기본 spec fetch — SSRF 검증을 통과한 URL 에 대해서만 호출된다(호출 순서가 방어의 일부). */
async function defaultFetchSpec(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(SPEC_FETCH_TIMEOUT_MS),
    redirect: "error", // redirect 로 내부 주소에 재도달하는 SSRF 우회 차단
  });
  if (!res.ok) {
    throw new OpenApiParseError(
      "INVALID_SPEC",
      `스펙을 가져오지 못했습니다 (HTTP ${res.status}).`,
    );
  }
  return res.json();
}

/** spec 의 servers[0].url 을 base URL 후보로 뽑는다(상대 경로는 specUrl 기준으로 절대화). */
function resolveBaseUrl(doc: unknown, specUrl: string): string | null {
  const servers = (doc as { servers?: unknown }).servers;
  const first = Array.isArray(servers) ? servers[0] : undefined;
  const raw = (first as { url?: unknown } | undefined)?.url;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    return new URL(raw, specUrl).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function createOpenApiToolServerRoutes(deps: {
  da: OpenApiToolServerDataAccess;
  validateUrl?: typeof validateMcpUrl;
  fetchSpec?: (url: string) => Promise<unknown>;
  nodeEnv?: string;
  allowedCidrs?: string[];
  grants?: ResourceGrantsDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const validateUrl = deps.validateUrl ?? validateMcpUrl;
  const fetchSpec = deps.fetchSpec ?? defaultFetchSpec;

  const validatorOptions = {
    ...(deps.nodeEnv !== undefined ? { nodeEnv: deps.nodeEnv } : {}),
    ...(deps.allowedCidrs !== undefined
      ? { allowedCidrs: deps.allowedCidrs }
      : {}),
  };

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return {
      userId: auth.sub,
      orgId: auth.org,
      isAdmin: auth.role === "admin" || auth.role === "owner",
    };
  }

  async function ownedByOrg(orgId: string, id: string) {
    const found = await deps.da.openApiToolServers.byId(id);
    return found && found.orgId === orgId ? found : null;
  }

  /**
   * spec URL 검증 → fetch → 파싱 → base URL 검증 순서. 각 단계 실패는 계약 에러코드로 매핑한다.
   * 순서가 곧 방어다: SSRF 검증 이전에는 어떤 네트워크 호출도 하지 않는다.
   */
  async function discover(
    specUrl: string,
    baseUrlOverride: string | null,
  ): Promise<
    | {
        ok: true;
        baseUrl: string;
        tools: AgentToolSpec[];
        operations: OpenApiOperation[];
      }
    | { ok: false; status: 400; code: string; message: string }
  > {
    try {
      await validateUrl(specUrl, validatorOptions);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        code: "SSRF_BLOCKED",
        message: err instanceof Error ? err.message : "spec URL 검증 실패",
      };
    }

    let doc: unknown;
    try {
      doc = await fetchSpec(specUrl);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_SPEC",
        message:
          err instanceof Error ? err.message : "스펙을 가져오지 못했습니다.",
      };
    }

    let operations: OpenApiOperation[];
    try {
      operations = parseOpenApiDocument(doc);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        code:
          err instanceof OpenApiParseError
            ? err.code
            : ("INVALID_SPEC" as const),
        message:
          err instanceof Error
            ? err.message
            : "OpenAPI 문서를 해석할 수 없습니다.",
      };
    }

    const baseUrl = baseUrlOverride ?? resolveBaseUrl(doc, specUrl);
    if (baseUrl === null) {
      return {
        ok: false,
        status: 400,
        code: "INVALID_SPEC",
        message:
          "base URL 을 결정할 수 없습니다 — spec 의 servers[0].url 이 없으면 baseUrl 을 직접 지정하세요.",
      };
    }

    // 승인서 C13 필수 조건: endpoint base URL 도 spec URL 과 동일하게 SSRF 검증한다.
    try {
      await validateUrl(baseUrl, validatorOptions);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        code: "SSRF_BLOCKED",
        message: err instanceof Error ? err.message : "base URL 검증 실패",
      };
    }

    return { ok: true, baseUrl, operations, tools: [] };
  }

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (typeof body.specUrl !== "string" || body.specUrl.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "specUrl 이 필요합니다."), 400);
    }
    const actor = actorOf(c);
    const scope = (body.scope ?? {}) as { projectId?: string; userId?: string };
    if (scope.userId !== undefined && scope.userId !== actor.userId) {
      return c.json(
        errorJson("FORBIDDEN", "본인 scope 로만 등록할 수 있습니다."),
        403,
      );
    }

    const result = await discover(
      body.specUrl,
      typeof body.baseUrl === "string" && body.baseUrl.trim() !== ""
        ? body.baseUrl
        : null,
    );
    if (!result.ok) {
      return c.json(errorJson(result.code, result.message), result.status);
    }

    // 서버 id 가 tool name 에 들어가므로(openapi:{serverId}:{operationId}) insert 후 spec 조립.
    const created = await deps.da.openApiToolServers.insert({
      orgId: actor.orgId,
      projectId: scope.projectId ?? null,
      userId: scope.userId ?? null,
      name: body.name,
      specUrl: body.specUrl,
      baseUrl: result.baseUrl,
      authHeaderName:
        typeof body.authHeaderName === "string" ? body.authHeaderName : null,
      authSecretArn:
        typeof body.authSecretArn === "string" ? body.authSecretArn : null,
      supportedTools: [],
      operations: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const tools = result.operations.map((op) =>
      openApiOperationToAgentToolSpec(created.id, op),
    );
    await deps.da.openApiToolServers.updateDiscovery(
      created.id,
      tools,
      result.operations,
    );
    const final = (await deps.da.openApiToolServers.byId(created.id)) ?? {
      ...created,
      supportedTools: tools,
      operations: result.operations,
      lastDiscoveredAt: new Date(),
    };
    return c.json(
      { data: toDto(final), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const page = await deps.da.openApiToolServers.list({ orgId: actor.orgId });
    const scoped = page.items.filter(
      (s) => s.userId === null || s.userId === actor.userId,
    );
    if (!deps.grants) {
      return c.json({
        data: scoped.map(toDto),
        meta: { requestId: randomUUID() },
      });
    }
    const accessible = await filterAccessibleResourceIds(deps.grants, {
      orgId: actor.orgId,
      userId: actor.userId,
      resourceType: "tool",
      resourceIds: scoped.map((s) => s.id),
      access: "read",
    });
    return c.json({
      data: scoped.filter((s) => accessible.has(s.id)).map(toDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/:id/refresh", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByOrg(actor.orgId, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "openapi tool server 를 찾을 수 없습니다."),
        404,
      );
    }
    const result = await discover(existing.specUrl, existing.baseUrl);
    if (!result.ok) {
      return c.json(errorJson(result.code, result.message), result.status);
    }
    const tools = result.operations.map((op) =>
      openApiOperationToAgentToolSpec(existing.id, op),
    );
    await deps.da.openApiToolServers.updateDiscovery(
      existing.id,
      tools,
      result.operations,
    );
    const updated = (await deps.da.openApiToolServers.byId(existing.id)) ?? {
      ...existing,
      supportedTools: tools,
      operations: result.operations,
    };
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByOrg(actor.orgId, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "openapi tool server 를 찾을 수 없습니다."),
        404,
      );
    }
    if (
      existing.userId !== null &&
      existing.userId !== actor.userId &&
      !actor.isAdmin
    ) {
      return c.json(
        errorJson("NOT_FOUND", "openapi tool server 를 찾을 수 없습니다."),
        404,
      );
    }
    await deps.da.openApiToolServers.delete(existing.id);
    return c.body(null, 204);
  });

  return app;
}

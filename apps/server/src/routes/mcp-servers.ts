// routes/mcp-servers.ts — 16-API-CONTRACT.md § 10 MCP Servers 단일 출처.
// db/mcp-server-data-access.ts(T1, P8-T1-01) 는 RLS 를 superuser role 로 우회하므로,
// org 경계(다른 org 의 서버 접근 차단)는 이 라우트가 application 레벨에서 강제한다
// (routes/memories.ts 와 동일 existence-leak 방지 패턴 — 404). URL 은 mcp/url-validator.ts
// (SSRF, RFC-1918 차단 + VPC CIDR 화이트리스트) 통과 없이는 등록 불가.
// 실 도구 discovery(mcp-bridge/mcp-client-pool)는 P8-T1-02 — 여기선 discover 를 주입점으로
// 남겨 기본은 no-op([]) 로 fail-soft.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { McpServerRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { McpServerDataAccess } from "../db/mcp-server-data-access.js";
import { validateMcpUrl } from "../mcp/url-validator.js";
import type { ResourceGrantsDataAccess } from "../db/resource-grants-data-access.js";
import { filterAccessibleResourceIds } from "../lib/access-control.js";

const TRANSPORTS = ["streamable_http", "sse"] as const;

function isTransport(v: unknown): v is McpServerRecord["transport"] {
  return typeof v === "string" && (TRANSPORTS as readonly string[]).includes(v);
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(server: McpServerRecord) {
  return {
    id: server.id,
    orgId: server.orgId,
    projectId: server.projectId,
    userId: server.userId,
    name: server.name,
    url: server.url,
    transport: server.transport,
    authHeaderName: server.authHeaderName,
    authSecretArn: server.authSecretArn,
    supportedTools: server.supportedTools,
    lastDiscoveredAt: server.lastDiscoveredAt
      ? server.lastDiscoveredAt.toISOString()
      : null,
    status: server.status,
  };
}

export function createMcpServerRoutes(deps: {
  da: McpServerDataAccess;
  validateUrl?: typeof validateMcpUrl;
  discover?: (
    server: McpServerRecord,
  ) => Promise<McpServerRecord["supportedTools"]>;
  nodeEnv?: string;
  allowedCidrs?: string[];
  grants?: ResourceGrantsDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const validateUrl = deps.validateUrl ?? validateMcpUrl;
  const discover = deps.discover ?? (async () => []);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return {
      userId: auth.sub,
      orgId: auth.org,
      isAdmin: auth.role === "admin" || auth.role === "owner",
    };
  }

  async function ownedByOrg(orgId: string, id: string) {
    const found = await deps.da.mcpServers.byId(id);
    return found && found.orgId === orgId ? found : null;
  }

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (typeof body.url !== "string") {
      return c.json(errorJson("INVALID_INPUT", "url 이 필요합니다."), 400);
    }
    if (!isTransport(body.transport)) {
      return c.json(
        errorJson("INVALID_INPUT", "transport 가 올바르지 않습니다."),
        400,
      );
    }
    const actor = actorOf(c);
    const scope = (body.scope ?? {}) as {
      projectId?: string;
      userId?: string;
    };
    if (scope.userId !== undefined && scope.userId !== actor.userId) {
      return c.json(
        errorJson("FORBIDDEN", "본인 scope 로만 등록할 수 있습니다."),
        403,
      );
    }
    try {
      await validateUrl(body.url, {
        ...(deps.nodeEnv !== undefined ? { nodeEnv: deps.nodeEnv } : {}),
        ...(deps.allowedCidrs !== undefined
          ? { allowedCidrs: deps.allowedCidrs }
          : {}),
      });
    } catch (err) {
      return c.json(
        errorJson(
          "SSRF_BLOCKED",
          err instanceof Error ? err.message : "url 검증 실패",
        ),
        400,
      );
    }
    const created = await deps.da.mcpServers.insert({
      orgId: actor.orgId,
      projectId: scope.projectId ?? null,
      userId: scope.userId ?? null,
      name: body.name,
      url: body.url,
      transport: body.transport,
      authHeaderName:
        typeof body.authHeaderName === "string" ? body.authHeaderName : null,
      authSecretArn:
        typeof body.authSecretArn === "string" ? body.authSecretArn : null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const tools = await discover(created).catch(() => []);
    if (tools.length > 0) {
      await deps.da.mcpServers.updateDiscovery(created.id, tools);
    }
    const final = (await deps.da.mcpServers.byId(created.id)) ?? created;
    return c.json(
      { data: toDto(final), meta: { requestId: randomUUID() } },
      201,
    );
  });

  async function applyGrantsFilter(
    servers: McpServerRecord[],
    actor: { orgId: string; userId: string },
  ): Promise<McpServerRecord[]> {
    if (!deps.grants) return servers;
    const accessible = await filterAccessibleResourceIds(deps.grants, {
      orgId: actor.orgId,
      userId: actor.userId,
      resourceType: "tool",
      resourceIds: servers.map((s) => s.id),
      access: "read",
    });
    return servers.filter((s) => accessible.has(s.id));
  }

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const projectIdParam = c.req.query("projectId");
    const userIdParam = c.req.query("userId");
    if (projectIdParam !== undefined || userIdParam !== undefined) {
      const page = await deps.da.mcpServers.list({
        orgId: actor.orgId,
        ...(projectIdParam !== undefined ? { projectId: projectIdParam } : {}),
        ...(userIdParam !== undefined ? { userId: userIdParam } : {}),
      });
      const visible = await applyGrantsFilter(page.items, actor);
      return c.json({
        data: visible.map(toDto),
        meta: { requestId: randomUUID() },
      });
    }
    const page = await deps.da.mcpServers.list({ orgId: actor.orgId });
    const scoped = page.items.filter(
      (s) => s.userId === null || s.userId === actor.userId,
    );
    const visible = await applyGrantsFilter(scoped, actor);
    return c.json({
      data: visible.map(toDto),
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/:id/refresh", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByOrg(actor.orgId, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "mcp server 를 찾을 수 없습니다."),
        404,
      );
    }
    const tools = await discover(existing);
    await deps.da.mcpServers.updateDiscovery(existing.id, tools);
    const updated = (await deps.da.mcpServers.byId(existing.id)) ?? existing;
    return c.json({ data: toDto(updated), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const existing = await ownedByOrg(actor.orgId, c.req.param("id"));
    if (!existing) {
      return c.json(
        errorJson("NOT_FOUND", "mcp server 를 찾을 수 없습니다."),
        404,
      );
    }
    if (
      existing.userId !== null &&
      existing.userId !== actor.userId &&
      !actor.isAdmin
    ) {
      return c.json(
        errorJson("NOT_FOUND", "mcp server 를 찾을 수 없습니다."),
        404,
      );
    }
    await deps.da.mcpServers.delete(existing.id);
    return c.body(null, 204);
  });

  return app;
}

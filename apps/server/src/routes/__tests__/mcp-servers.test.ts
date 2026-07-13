// mcp-servers.test.ts — P8-T1-01 RED: routes/mcp-servers.ts 가 createMcpServerRoutes 를 export 안함.
// 16-API-CONTRACT § 10 — POST(SSRF validator 통과 의무)/GET(scope 필터)/POST :id/refresh/DELETE.
// SSRF 차단은 url-validator.test.ts 가 단위 검증 — 여기선 route 가 validateUrl 을 실제로 호출해
// 실패 시 400 으로 매핑하는지, org 경계(actor.orgId 강제) + existence-leak 방지(404)를 검증한다.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { McpServerRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createMcpServerRoutes } from "../mcp-servers.js";
import type { McpServerDataAccess } from "../../db/mcp-server-data-access.js";
import { McpUrlValidationError } from "../../mcp/url-validator.js";

function makeDa(): McpServerDataAccess {
  const rows: McpServerRecord[] = [];
  return {
    mcpServers: {
      async insert(data) {
        const row = { id: randomUUID(), ...data } as McpServerRecord;
        rows.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        rows[idx] = { ...rows[idx], ...data } as McpServerRecord;
        return rows[idx];
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (!filter?.orgId || r.orgId === filter.orgId) &&
              (filter?.projectId === undefined ||
                r.projectId === filter.projectId) &&
              (filter?.userId === undefined || r.userId === filter.userId),
          ),
        };
      },
      async updateDiscovery(id, supportedTools) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) {
          rows[idx] = {
            ...rows[idx],
            supportedTools,
            lastDiscoveredAt: new Date(),
          };
        }
      },
    },
  };
}

function appWith(
  da: McpServerDataAccess,
  actor: { userId: string; orgId: string },
  extra: Partial<Parameters<typeof createMcpServerRoutes>[0]> = {},
) {
  const routes = createMcpServerRoutes({ da, ...extra });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

let userId: string;
let orgId: string;
let otherOrgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
  otherOrgId = randomUUID();
});

describe("createMcpServerRoutes", () => {
  it("POST / — SSRF validator 통과 시 신규 서버를 생성한다", async () => {
    const da = makeDa();
    const app = appWith(
      da,
      { userId, orgId },
      { validateUrl: async () => ({}) as never },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "사내 검색 MCP",
        url: "https://mcp.internal.example.com/",
        transport: "streamable_http",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: McpServerRecord };
    expect(body.data.orgId).toBe(orgId);
    expect(body.data.name).toBe("사내 검색 MCP");
    expect(body.data.status).toBe("active");
  });

  it("POST / — SSRF validator 가 거부하면 400", async () => {
    const da = makeDa();
    const app = appWith(
      da,
      { userId, orgId },
      {
        validateUrl: async () => {
          throw new McpUrlValidationError(
            "INTERNAL_IP_FORBIDDEN",
            "내부 IP 차단",
          );
        },
      },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "사설망 MCP",
        url: "http://10.0.0.1/",
        transport: "sse",
      }),
    });
    expect(res.status).toBe(400);
    expect((await da.mcpServers.list({ orgId })).items).toHaveLength(0);
  });

  it("POST / — transport 가 올바르지 않으면 400", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "x",
        url: "https://a.example.com/",
        transport: "bogus",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("GET / — 자신의 org 서버만 조회한다 (org 경계)", async () => {
    const da = makeDa();
    await da.mcpServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "mine-org",
      url: "https://a.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    await da.mcpServers.insert({
      orgId: otherOrgId,
      projectId: null,
      userId: null,
      name: "other-org",
      url: "https://b.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: McpServerRecord[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("mine-org");
  });

  it("POST /:id/refresh — discover 결과로 supportedTools 를 갱신한다", async () => {
    const da = makeDa();
    const created = await da.mcpServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "discover-me",
      url: "https://discover.example.com/",
      transport: "streamable_http",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const tools = [
      { name: "search", description: "검색", inputSchema: { type: "object" } },
    ];
    const app = appWith(da, { userId, orgId }, { discover: async () => tools });

    const res = await app.request(`/${created.id}/refresh`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: McpServerRecord };
    expect(body.data.supportedTools).toEqual(tools);
  });

  it("DELETE /:id — 다른 org 의 서버는 404 (existence-leak 방지)", async () => {
    const da = makeDa();
    const created = await da.mcpServers.insert({
      orgId: otherOrgId,
      projectId: null,
      userId: null,
      name: "theirs",
      url: "https://c.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const app = appWith(da, { userId, orgId });

    const res = await app.request(`/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await da.mcpServers.byId(created.id)).not.toBeNull();
  });

  it("DELETE /:id — 자신의 org 서버는 삭제한다", async () => {
    const da = makeDa();
    const created = await da.mcpServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "mine",
      url: "https://d.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const app = appWith(da, { userId, orgId });

    const res = await app.request(`/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    expect(await da.mcpServers.byId(created.id)).toBeNull();
  });
});

// openapi-tool-servers.test.ts — P22-T1-12 RED: routes/openapi-tool-servers.ts 가
// createOpenApiToolServerRoutes 를 export 하지 않는다(모듈 자체가 없음).
// 갭 카탈로그 P22-T1-12 acceptance 중 서버측 3건을 검증한다:
//   (1) 유효한 OpenAPI 3.x 스펙 등록 → operation 별 AgentToolSpec 이 영속·노출
//   (2) 등록된 서버의 endpoint 호출이 SSRF 검증을 거친다
//   (3) 사설/내부 주소 스펙 URL 은 거부되고 fetch 자체가 일어나지 않는다
// SSRF 알고리즘 자체는 mcp/url-validator.test.ts 가 단위 검증 — 여기선 route 가
// validateUrl 을 실제로 호출하고 실패를 400 으로 매핑하는지, org 경계(404 existence-leak
// 방지)를 지키는지를 본다(mcp-servers.test.ts 미러).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createOpenApiToolServerRoutes } from "../openapi-tool-servers.js";
import type {
  OpenApiToolServerDataAccess,
  OpenApiToolServerRecord,
} from "../../db/openapi-tool-server-data-access.js";
import { McpUrlValidationError } from "../../mcp/url-validator.js";

const PETSTORE_SPEC = {
  openapi: "3.0.3",
  info: { title: "Petstore", version: "1.0.0" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/pets": {
      get: {
        operationId: "listPets",
        summary: "펫 목록",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
      },
      post: {
        operationId: "createPet",
        summary: "펫 생성",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" } },
              },
            },
          },
        },
      },
    },
  },
};

function makeDa(): OpenApiToolServerDataAccess {
  const rows: OpenApiToolServerRecord[] = [];
  return {
    openApiToolServers: {
      async insert(data) {
        const row = { id: randomUUID(), ...data };
        rows.push(row);
        return row;
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              r.orgId === filter.orgId &&
              (filter.projectId === undefined ||
                r.projectId === filter.projectId) &&
              (filter.userId === undefined || r.userId === filter.userId),
          ),
        };
      },
      async updateDiscovery(id, supportedTools) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) {
          rows[idx] = {
            ...(rows[idx] as OpenApiToolServerRecord),
            supportedTools,
            lastDiscoveredAt: new Date(),
          };
        }
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
    },
  };
}

function appWith(
  da: OpenApiToolServerDataAccess,
  actor: { userId: string; orgId: string; role?: "member" | "admin" },
  extra: Partial<Parameters<typeof createOpenApiToolServerRoutes>[0]> = {},
) {
  const routes = createOpenApiToolServerRoutes({
    da,
    validateUrl: async () => ({}) as never,
    fetchSpec: async () => PETSTORE_SPEC,
    ...extra,
  });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role ?? "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

function registerBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "사내 Petstore",
    specUrl: "https://api.example.com/openapi.json",
    ...overrides,
  });
}

const JSON_HEADERS = { "content-type": "application/json" };

let userId: string;
let orgId: string;
let otherOrgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
  otherOrgId = randomUUID();
});

describe("createOpenApiToolServerRoutes", () => {
  it("POST / — 유효한 OpenAPI 3.x 스펙을 등록하면 operation 마다 AgentToolSpec 이 생성된다", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: registerBody(),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        orgId: string;
        baseUrl: string;
        status: string;
        supportedTools: Array<{ name: string; defaultPolicy: string }>;
        lastDiscoveredAt: string | null;
      };
    };
    expect(body.data.orgId).toBe(orgId);
    // spec 의 servers[0].url 이 base URL 로 채택된다
    expect(body.data.baseUrl).toBe("https://api.example.com/v1");
    expect(body.data.status).toBe("active");
    expect(body.data.supportedTools).toHaveLength(2);
    const names = body.data.supportedTools.map((t) => t.name);
    expect(names.some((n) => n.endsWith(":listPets"))).toBe(true);
    expect(names.some((n) => n.endsWith(":createPet"))).toBe(true);
    // 외부 HTTP 호출이므로 기본 정책은 사람 승인(hitl)
    expect(body.data.supportedTools[0]?.defaultPolicy).toBe("hitl");
    expect(body.data.lastDiscoveredAt).not.toBeNull();
  });

  it("POST / — 사설/내부 주소 spec URL 은 400 SSRF_BLOCKED 이고 spec fetch 를 시도하지 않는다", async () => {
    const da = makeDa();
    let fetched = 0;
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
        fetchSpec: async () => {
          fetched++;
          return PETSTORE_SPEC;
        },
      },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: registerBody({ specUrl: "http://169.254.169.254/openapi.json" }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("SSRF_BLOCKED");
    expect(fetched).toBe(0);
    expect((await da.openApiToolServers.list({ orgId })).items).toHaveLength(0);
  });

  it("POST / — endpoint base URL 도 SSRF 검증 대상이다(spec URL 만 통과해선 안 된다)", async () => {
    const da = makeDa();
    const validated: string[] = [];
    const app = appWith(
      da,
      { userId, orgId },
      {
        validateUrl: async (url: string) => {
          validated.push(url);
          if (url.startsWith("http://127.0.0.1")) {
            throw new McpUrlValidationError(
              "INTERNAL_IP_FORBIDDEN",
              "내부 IP 차단",
            );
          }
          return {} as never;
        },
        fetchSpec: async () => ({
          ...PETSTORE_SPEC,
          servers: [{ url: "http://127.0.0.1:9000" }],
        }),
      },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: registerBody(),
    });

    expect(res.status).toBe(400);
    expect(validated).toContain("https://api.example.com/openapi.json");
    expect(validated).toContain("http://127.0.0.1:9000");
    expect((await da.openApiToolServers.list({ orgId })).items).toHaveLength(0);
  });

  it("POST / — OpenAPI 3.x 문서가 아니면(swagger 2.0) 400 UNSUPPORTED_VERSION", async () => {
    const da = makeDa();
    const app = appWith(
      da,
      { userId, orgId },
      { fetchSpec: async () => ({ swagger: "2.0", paths: {} }) },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: registerBody(),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    // 어댑터가 버전 불일치를 INVALID_SPEC 보다 좁은 코드로 구분한다(파싱 실패와 구별).
    expect(body.error.code).toBe("UNSUPPORTED_VERSION");
  });

  it("POST / — 3.x 이지만 paths 가 없는 깨진 문서는 400 INVALID_SPEC", async () => {
    const da = makeDa();
    const app = appWith(
      da,
      { userId, orgId },
      { fetchSpec: async () => ({ openapi: "3.0.0", info: {} }) },
    );

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: registerBody(),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_SPEC");
  });

  it("POST / — name/specUrl 누락은 400 INVALID_INPUT", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const noName = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ specUrl: "https://a.example.com/o.json" }),
    });
    expect(noName.status).toBe(400);

    const noUrl = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "x" }),
    });
    expect(noUrl.status).toBe(400);
  });

  it("GET / — 자신의 org 서버만 보이고 다른 org 것은 새지 않는다", async () => {
    const da = makeDa();
    await da.openApiToolServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "우리 org",
      specUrl: "https://a.example.com/o.json",
      baseUrl: "https://a.example.com",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    await da.openApiToolServers.insert({
      orgId: otherOrgId,
      projectId: null,
      userId: null,
      name: "남의 org",
      specUrl: "https://b.example.com/o.json",
      baseUrl: "https://b.example.com",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    const res = await appWith(da, { userId, orgId }).request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.name).toBe("우리 org");
  });

  it("POST /:id/refresh — 스펙을 다시 읽어 supportedTools 를 갱신한다", async () => {
    const da = makeDa();
    const created = await da.openApiToolServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "우리 org",
      specUrl: "https://api.example.com/openapi.json",
      baseUrl: "https://api.example.com/v1",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    const res = await appWith(da, { userId, orgId }).request(
      `/${created.id}/refresh`,
      { method: "POST" },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { supportedTools: Array<{ name: string }> };
    };
    expect(body.data.supportedTools).toHaveLength(2);
  });

  it("POST /:id/refresh — 다른 org 의 서버는 404(존재 여부를 노출하지 않는다)", async () => {
    const da = makeDa();
    const created = await da.openApiToolServers.insert({
      orgId: otherOrgId,
      projectId: null,
      userId: null,
      name: "남의 org",
      specUrl: "https://b.example.com/o.json",
      baseUrl: "https://b.example.com",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    const res = await appWith(da, { userId, orgId }).request(
      `/${created.id}/refresh`,
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — 자신의 org 서버는 204, 다른 org 는 404", async () => {
    const da = makeDa();
    const mine = await da.openApiToolServers.insert({
      orgId,
      projectId: null,
      userId: null,
      name: "우리 org",
      specUrl: "https://a.example.com/o.json",
      baseUrl: "https://a.example.com",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    const theirs = await da.openApiToolServers.insert({
      orgId: otherOrgId,
      projectId: null,
      userId: null,
      name: "남의 org",
      specUrl: "https://b.example.com/o.json",
      baseUrl: "https://b.example.com",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    const app = appWith(da, { userId, orgId });
    expect(
      (await app.request(`/${mine.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(
      (await app.request(`/${theirs.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect((await da.openApiToolServers.list({ orgId })).items).toHaveLength(0);
    expect(
      (await da.openApiToolServers.list({ orgId: otherOrgId })).items,
    ).toHaveLength(1);
  });
});

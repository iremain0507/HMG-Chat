// db/mcp-server-data-access.ts 의 McpServerRepo pg 구현체 — 06-DATA-MODEL.md § 0009 /
// 14-INTERFACES.md McpServerRepo 단일 출처. RLS(app.org_id/app.user_id) 는 rls-*.test.ts 가 별도 검증.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import { createPgMcpServerDataAccess } from "../../db/mcp-server-data-access";

describe("mcp-server-data-access (McpServerRepo)", () => {
  const da = createPgMcpServerDataAccess();
  const org = {
    id: randomUUID(),
    domain: `org-mcp-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-mcp-${randomUUID()}@${org.domain}`,
  };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MCP', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterEach(async () => {
    await pgPool.query("DELETE FROM mcp_servers WHERE org_id = $1", [org.id]);
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("insert 후 byId 로 조회된다", async () => {
    const created = await da.mcpServers.insert({
      orgId: org.id,
      projectId: null,
      userId: user.id,
      name: "사내 검색 MCP",
      url: "https://mcp.internal.example.com/",
      transport: "streamable_http",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    expect(created.id).toBeTruthy();

    const found = await da.mcpServers.byId(created.id);
    expect(found?.name).toBe("사내 검색 MCP");
    expect(found?.transport).toBe("streamable_http");
    expect(found?.status).toBe("active");
    expect(found?.supportedTools).toEqual([]);
  });

  it("list 는 orgId/projectId/userId filter 를 적용한다", async () => {
    await da.mcpServers.insert({
      orgId: org.id,
      projectId: null,
      userId: user.id,
      name: "user-scoped",
      url: "https://a.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });
    await da.mcpServers.insert({
      orgId: org.id,
      projectId: null,
      userId: null,
      name: "org-shared",
      url: "https://b.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    const userScoped = await da.mcpServers.list({
      orgId: org.id,
      userId: user.id,
    });
    expect(userScoped.items).toHaveLength(1);
    expect(userScoped.items[0].name).toBe("user-scoped");

    const orgWide = await da.mcpServers.list({ orgId: org.id, userId: null });
    expect(orgWide.items).toHaveLength(1);
    expect(orgWide.items[0].name).toBe("org-shared");
  });

  it("updateDiscovery 는 supportedTools 와 lastDiscoveredAt 을 갱신한다", async () => {
    const created = await da.mcpServers.insert({
      orgId: org.id,
      projectId: null,
      userId: user.id,
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
    await da.mcpServers.updateDiscovery(created.id, tools);

    const found = await da.mcpServers.byId(created.id);
    expect(found?.supportedTools).toEqual(tools);
    expect(found?.lastDiscoveredAt).toBeInstanceOf(Date);
  });

  it("delete() 는 row 를 제거한다", async () => {
    const created = await da.mcpServers.insert({
      orgId: org.id,
      projectId: null,
      userId: user.id,
      name: "삭제될 서버",
      url: "https://gone.example.com/",
      transport: "sse",
      authHeaderName: null,
      authSecretArn: null,
      supportedTools: [],
      lastDiscoveredAt: null,
      status: "active",
    });

    await da.mcpServers.delete(created.id);
    expect(await da.mcpServers.byId(created.id)).toBeNull();
  });
});

// mcp-client-pool.test.ts — P8-T1-02 RED: mcp/mcp-client-pool.ts 모듈이 없어 실패한다.
// 14-INTERFACES.md § 8 McpClientPool 구현체 — list/byId/discover/invoke 를 JSON-RPC 2.0
// (fetchImpl 주입, lib/office-pdf-converter.ts 와 동일 DI 패턴) 위에서 검증한다.
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { McpServerRecord } from "@wchat/interfaces";
import { createMcpClientPool } from "../mcp-client-pool.js";
import type { McpServerDataAccess } from "../../db/mcp-server-data-access.js";

function makeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: randomUUID(),
    orgId: "org-1",
    projectId: null,
    userId: null,
    name: "검색 MCP",
    url: "https://mcp.example.com/",
    transport: "streamable_http",
    authHeaderName: null,
    authSecretArn: null,
    supportedTools: [],
    lastDiscoveredAt: null,
    status: "active",
    ...overrides,
  };
}

// 실 DNS 호출 방지 — 테스트 기본은 안전한 공인 IP 로 고정(dev-stub, 12-OPS-SECURITY.md 부록 B).
const SAFE_RESOLVE = async () => ["93.184.216.34"];

function makeDa(servers: McpServerRecord[]): McpServerDataAccess {
  return {
    mcpServers: {
      async insert(data) {
        const row = { id: randomUUID(), ...data } as McpServerRecord;
        servers.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = servers.findIndex((s) => s.id === id);
        if (idx === -1) throw new Error("not found");
        servers[idx] = { ...servers[idx], ...data } as McpServerRecord;
        return servers[idx];
      },
      async delete(id) {
        const idx = servers.findIndex((s) => s.id === id);
        if (idx !== -1) servers.splice(idx, 1);
      },
      async byId(id) {
        return servers.find((s) => s.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: servers.filter(
            (s) =>
              (!filter?.orgId || s.orgId === filter.orgId) &&
              (filter?.projectId === undefined ||
                s.projectId === filter.projectId),
          ),
        };
      },
      async updateDiscovery(id, supportedTools) {
        const idx = servers.findIndex((s) => s.id === id);
        if (idx !== -1) {
          servers[idx] = {
            ...servers[idx],
            supportedTools,
            lastDiscoveredAt: new Date(),
          };
        }
      },
    },
  };
}

describe("createMcpClientPool", () => {
  it("list — org scope 서버를 McpClient 로 변환한다", async () => {
    const server = makeServer({ status: "degraded" });
    const pool = createMcpClientPool({ da: makeDa([server]) });

    const clients = await pool.list({ orgId: "org-1", userId: "u-1" });
    expect(clients).toEqual([
      {
        id: server.id,
        name: server.name,
        url: server.url,
        transport: server.transport,
        health: "degraded",
        lastDiscoveredAt: null,
      },
    ]);
  });

  it("list — 다른 사용자 소유 서버는 제외한다", async () => {
    const mine = makeServer({ userId: "u-1" });
    const theirs = makeServer({ userId: "u-2" });
    const pool = createMcpClientPool({ da: makeDa([mine, theirs]) });

    const clients = await pool.list({ orgId: "org-1", userId: "u-1" });
    expect(clients.map((c) => c.id)).toEqual([mine.id]);
  });

  it("byId — 없는 서버는 null", async () => {
    const pool = createMcpClientPool({ da: makeDa([]) });
    expect(await pool.byId(randomUUID())).toBeNull();
  });

  it("discover — tools/list 호출 결과를 AgentToolSpec[] 로 변환한다", async () => {
    const server = makeServer();
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "x",
          result: { tools: [{ name: "search", description: "검색" }] },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: SAFE_RESOLVE,
    });

    const specs = await pool.discover(server.id);
    expect(specs).toEqual([
      {
        name: `mcp:${server.id}:search`,
        description: "검색",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "hitl",
      },
    ]);
    expect(calls[0]?.body).toMatchObject({ method: "tools/list" });
  });

  it("discover — 서버가 없으면 빈 배열", async () => {
    const pool = createMcpClientPool({ da: makeDa([]) });
    expect(await pool.discover(randomUUID())).toEqual([]);
  });

  it("discover — url 이 SSRF 검증에 실패하면 tools/list 를 호출하지 않고 reject 한다", async () => {
    const server = makeServer({ url: "https://internal.example.com/" });
    const calls: unknown[] = [];
    const fetchImpl = (async () => {
      calls.push(1);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: "x", result: { tools: [] } }),
        { status: 200 },
      );
    }) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: async () => ["10.0.0.5"], // 사설 IP — DNS rebinding 시나리오
    });

    await expect(pool.discover(server.id)).rejects.toMatchObject({
      category: "mcp",
    });
    expect(calls).toHaveLength(0);
  });

  it("discover — 이전 discover 대비 tool description 이 변경되면 tags:description-changed 를 포함한다(rug-pull 방어)", async () => {
    const server = makeServer({
      supportedTools: [
        {
          name: "search",
          description: "원래 설명(승인 시점)",
          inputSchema: { type: "object" },
        },
      ],
    });
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "x",
          result: {
            tools: [{ name: "search", description: "변조된 새 설명" }],
          },
        }),
        { status: 200 },
      )) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: SAFE_RESOLVE,
    });

    const specs = await pool.discover(server.id);
    expect(specs[0]?.tags).toContain("description-changed");
    expect(specs[0]?.defaultPolicy).toBe("hitl");
  });

  it("invoke — tools/call 결과를 AgentToolResult 로 변환한다", async () => {
    const server = makeServer();
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "x",
          result: { content: [{ type: "text", text: "완료" }] },
        }),
        { status: 200 },
      )) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: SAFE_RESOLVE,
    });

    const result = await pool.invoke(
      server.id,
      "search",
      { q: "test" },
      new AbortController().signal,
    );
    expect(result.content).toEqual({ kind: "text", text: "완료" });
  });

  it("invoke — HTTP 오류는 WChatError(category:mcp) 로 throw", async () => {
    const server = makeServer();
    const fetchImpl = (async () =>
      new Response("boom", { status: 500 })) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: SAFE_RESOLVE,
    });

    await expect(
      pool.invoke(server.id, "search", {}, new AbortController().signal),
    ).rejects.toMatchObject({ category: "mcp" });
  });

  it("invoke — url 이 SSRF 검증에 실패하면 tools/call 을 호출하지 않고 reject 한다(매 invoke 재검증)", async () => {
    const server = makeServer({ url: "https://internal.example.com/" });
    const calls: unknown[] = [];
    const fetchImpl = (async () => {
      calls.push(1);
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: "x",
          result: { content: [] },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const pool = createMcpClientPool({
      da: makeDa([server]),
      fetchImpl,
      resolveHostname: async () => ["10.0.0.5"], // 등록 이후 DNS 가 사설 IP 로 바뀐 rebinding 시나리오
    });

    await expect(
      pool.invoke(server.id, "search", {}, new AbortController().signal),
    ).rejects.toMatchObject({ category: "mcp" });
    expect(calls).toHaveLength(0);
  });
});

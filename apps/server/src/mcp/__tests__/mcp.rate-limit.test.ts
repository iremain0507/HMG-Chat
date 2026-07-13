// mcp.rate-limit.test.ts — P8-T1-02 RED: mcp/mcp-client-pool.ts 의 invoke() 에 quota(L16 RateLimiter)
// 가 아직 없어 실패한다. 08-SPRINT-PLAN.md Phase 8 gate: "MCP 도구 호출에 시간/비용 quota"
// (01-LESSONS-LEARNED.md L16). server 단위 고정 윈도우 카운터 — 초과 시 WChatError(category:"rate-limit").
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { McpServerRecord } from "@wchat/interfaces";
import { createMcpClientPool } from "../mcp-client-pool.js";
import type { McpServerDataAccess } from "../../db/mcp-server-data-access.js";

function makeServer(): McpServerRecord {
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
  };
}

function makeDa(server: McpServerRecord): McpServerDataAccess {
  return {
    mcpServers: {
      async insert(data) {
        return { id: randomUUID(), ...data } as McpServerRecord;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update() {
        return server;
      },
      async delete() {},
      async byId(id) {
        return id === server.id ? server : null;
      },
      async list() {
        return { items: [server] };
      },
      async updateDiscovery() {},
    },
  };
}

function okFetch(): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "x",
        result: { content: [{ type: "text", text: "ok" }] },
      }),
      { status: 200 },
    )) as typeof fetch;
}

describe("mcp-client-pool invoke rate-limit (L16 quota)", () => {
  it("윈도우 안에서 maxCalls 를 초과하면 WChatError(rate-limit) 를 throw 한다", async () => {
    const server = makeServer();
    const t = 0;
    const pool = createMcpClientPool({
      da: makeDa(server),
      fetchImpl: okFetch(),
      now: () => t,
      rateLimit: { maxCalls: 2, windowMs: 60_000 },
    });
    const signal = new AbortController().signal;

    await pool.invoke(server.id, "search", {}, signal);
    await pool.invoke(server.id, "search", {}, signal);

    await expect(
      pool.invoke(server.id, "search", {}, signal),
    ).rejects.toMatchObject({
      category: "rate-limit",
      code: "MCP_RATE_LIMIT_EXCEEDED",
    });
  });

  it("윈도우가 지나면 카운터가 리셋된다", async () => {
    const server = makeServer();
    let t = 0;
    const pool = createMcpClientPool({
      da: makeDa(server),
      fetchImpl: okFetch(),
      now: () => t,
      rateLimit: { maxCalls: 1, windowMs: 1_000 },
    });
    const signal = new AbortController().signal;

    await pool.invoke(server.id, "search", {}, signal);
    t = 1_001;
    await expect(
      pool.invoke(server.id, "search", {}, signal),
    ).resolves.toMatchObject({ content: { kind: "text", text: "ok" } });
  });

  it("서버가 다르면 카운터가 독립적이다", async () => {
    const server1 = makeServer();
    const server2 = makeServer();
    const servers = [server1, server2];
    const da: McpServerDataAccess = {
      mcpServers: {
        async insert(data) {
          return { id: randomUUID(), ...data } as McpServerRecord;
        },
        async bulkInsert(items) {
          return Promise.all(items.map((r) => this.insert(r)));
        },
        async update() {
          return server1;
        },
        async delete() {},
        async byId(id) {
          return servers.find((s) => s.id === id) ?? null;
        },
        async list() {
          return { items: servers };
        },
        async updateDiscovery() {},
      },
    };
    const pool = createMcpClientPool({
      da,
      fetchImpl: okFetch(),
      now: () => 0,
      rateLimit: { maxCalls: 1, windowMs: 60_000 },
    });
    const signal = new AbortController().signal;

    await pool.invoke(server1.id, "search", {}, signal);
    await expect(
      pool.invoke(server2.id, "search", {}, signal),
    ).resolves.toMatchObject({ content: { kind: "text", text: "ok" } });
  });
});

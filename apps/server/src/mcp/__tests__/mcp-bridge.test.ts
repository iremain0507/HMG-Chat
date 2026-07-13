// mcp-bridge.test.ts — P8-T1-02 RED: mcp/mcp-bridge.ts 모듈이 없어 실패한다.
// 08-SPRINT-PLAN.md Phase 8: "mcp-bridge.test.ts — 도구 발견 + 등록" +
// gate "새 MCP server 등록 후 30초 안에 도구 자동 발견". routes/mcp-servers.ts 의
// discover 주입점(McpServerRecord["supportedTools"] 반환)과 계약이 맞아야 한다.
import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  AgentToolSpec,
  McpClientPool,
  McpServerRecord,
} from "@wchat/interfaces";
import { createMcpBridge } from "../mcp-bridge.js";

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

function makePool(discover: McpClientPool["discover"]): McpClientPool {
  return {
    list: async () => [],
    byId: async () => null,
    discover,
    invoke: async () => {
      throw new Error("not used");
    },
  };
}

describe("createMcpBridge", () => {
  it("discoverServerTools — pool.discover 결과를 도구로 발견하고 등록한다", async () => {
    const server = makeServer();
    const specs: AgentToolSpec[] = [
      {
        name: `mcp:${server.id}:search`,
        description: "검색",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "hitl",
      },
    ];
    const pool = makePool(async () => specs);
    const bridge = createMcpBridge({ pool });

    const tools = await bridge.discoverServerTools(server);
    expect(tools).toEqual([
      {
        name: specs[0].name,
        description: "검색",
        inputSchema: { type: "object" },
      },
    ]);
    expect(bridge.listRegisteredTools(server.id)).toEqual(specs);
    expect(bridge.listRegisteredTools()).toEqual(specs);
  });

  it("discover 가 30초 안에 응답하지 않으면 빈 배열로 fail-soft 한다 (Gate: 30초 이내 자동 발견)", async () => {
    vi.useFakeTimers();
    try {
      const server = makeServer();
      const pool = makePool(() => new Promise(() => {})); // 영원히 resolve 안 함
      const bridge = createMcpBridge({ pool, discoveryTimeoutMs: 30_000 });

      const promise = bridge.discoverServerTools(server);
      await vi.advanceTimersByTimeAsync(30_000);
      const tools = await promise;

      expect(tools).toEqual([]);
      expect(bridge.listRegisteredTools(server.id)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("discover 가 throw 하면 빈 배열로 fail-soft 한다", async () => {
    const server = makeServer();
    const pool = makePool(async () => {
      throw new Error("mcp server down");
    });
    const bridge = createMcpBridge({ pool });

    await expect(bridge.discoverServerTools(server)).resolves.toEqual([]);
  });

  it("listRegisteredTools — 서버별로 독립 등록된다", async () => {
    const server1 = makeServer();
    const server2 = makeServer();
    const spec1: AgentToolSpec = {
      name: `mcp:${server1.id}:a`,
      description: "a",
      inputSchema: { type: "object" },
      permissionTier: "tool",
      defaultPolicy: "hitl",
    };
    const spec2: AgentToolSpec = {
      name: `mcp:${server2.id}:b`,
      description: "b",
      inputSchema: { type: "object" },
      permissionTier: "tool",
      defaultPolicy: "hitl",
    };
    let call = 0;
    const pool = makePool(async () => (call++ === 0 ? [spec1] : [spec2]));
    const bridge = createMcpBridge({ pool });

    await bridge.discoverServerTools(server1);
    await bridge.discoverServerTools(server2);

    expect(bridge.listRegisteredTools(server1.id)).toEqual([spec1]);
    expect(bridge.listRegisteredTools(server2.id)).toEqual([spec2]);
    expect(bridge.listRegisteredTools()).toEqual([spec1, spec2]);
  });
});

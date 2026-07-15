// mcp/mcp-bridge.ts — routes/mcp-servers.ts 의 discover 주입점과 orchestrator 도구 레지스트리를
// 잇는 다리. McpClientPool.discover 를 30초 타임아웃으로 감싸 실패/지연 시 fail-soft([]) 하고
// (08-SPRINT-PLAN.md Phase 8 gate: "새 MCP server 등록 후 30초 안에 도구 자동 발견"),
// 발견된 도구를 서버별로 등록해 listRegisteredTools 로 조회 가능하게 한다.
import type {
  AgentToolSpec,
  McpClientPool,
  McpServerRecord,
} from "@wchat/interfaces";

export interface McpBridgeOptions {
  pool: McpClientPool;
  discoveryTimeoutMs?: number;
}

export interface McpBridge {
  discoverServerTools(
    server: McpServerRecord,
  ): Promise<McpServerRecord["supportedTools"]>;
  listRegisteredTools(serverId?: string): AgentToolSpec[];
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 25_000;

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: T,
): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(onTimeout);
      },
    );
  });
}

export function createMcpBridge(opts: McpBridgeOptions): McpBridge {
  const timeoutMs = opts.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
  const registry = new Map<string, AgentToolSpec[]>();

  return {
    async discoverServerTools(server) {
      const specs = await withTimeout(
        opts.pool.discover(server.id),
        timeoutMs,
        [],
      );
      registry.set(server.id, specs);
      return specs.map((spec) => ({
        name: spec.name,
        description: spec.description,
        inputSchema: spec.inputSchema,
      }));
    },

    listRegisteredTools(serverId) {
      if (serverId) return registry.get(serverId) ?? [];
      return [...registry.values()].flat();
    },
  };
}

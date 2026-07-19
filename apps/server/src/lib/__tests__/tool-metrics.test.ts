// P22-T6-19(C17B) RED: toolSourceFromName 이 없어 import 가 타입/런타임 에러.
//   ToolMetricEntry.source 를 채우려면 툴 이름 규약(mcp:/openapi:/skill:)에서 출처를
//   순수 함수로 도출해야 한다 — 네이밍 단일 출처는 mcp/mcp-tool-adapter.ts(mcpToolName)·
//   tools/openapi-tool-adapter.ts(openApiToolName).
import { describe, it, expect } from "vitest";
import type { ToolMetricEntry, ToolMetricRepo } from "@wchat/interfaces";
import { recordToolMetric, toolSourceFromName } from "../tool-metrics.js";

function metricEntry(
  overrides: Partial<ToolMetricEntry> = {},
): ToolMetricEntry {
  return {
    toolName: "knowledge_search",
    status: "ok",
    durationMs: 120,
    userId: "user-1",
    orgId: "org-1",
    ...overrides,
  };
}

function fakeToolMetricRepo(): ToolMetricRepo & {
  appended: ToolMetricEntry[];
} {
  return {
    appended: [],
    async append(entry) {
      this.appended.push(entry);
    },
    async aggregate() {
      return { count: 0, errorCount: 0, p50DurationMs: 0 };
    },
  };
}

describe("tool-metrics.recordToolMetric", () => {
  it("tool_metrics 에 그대로 append 한다", async () => {
    const repo = fakeToolMetricRepo();
    const entry = metricEntry();

    await recordToolMetric(repo, entry);

    expect(repo.appended).toEqual([entry]);
  });

  it("error/timeout/denied/hitl-pending 상태도 그대로 기록한다", async () => {
    const repo = fakeToolMetricRepo();
    const entry = metricEntry({ status: "timeout", durationMs: 30_000 });

    await recordToolMetric(repo, entry);

    expect(repo.appended[0]?.status).toBe("timeout");
  });

  it("source 를 그대로 기록한다(계약 C17B)", async () => {
    const repo = fakeToolMetricRepo();

    await recordToolMetric(repo, metricEntry({ source: "mcp" }));

    expect(repo.appended[0]?.source).toBe("mcp");
  });
});

describe("tool-metrics.toolSourceFromName", () => {
  it("mcp:{serverId}:{tool} 네임스페이스는 mcp", () => {
    expect(toolSourceFromName("mcp:srv-1:search")).toBe("mcp");
  });

  it("openapi:{serverId}:{operationId} 네임스페이스는 openapi", () => {
    expect(toolSourceFromName("openapi:srv-1:getPet")).toBe("openapi");
  });

  it("skill:{name} 네임스페이스는 skill", () => {
    expect(toolSourceFromName("skill:pdf-fill")).toBe("skill");
  });

  it("네임스페이스가 없으면 내장 툴로 본다", () => {
    expect(toolSourceFromName("knowledge_search")).toBe("builtin");
    expect(toolSourceFromName("web_search")).toBe("builtin");
  });

  it("prefix 유사 이름(mcp_helper)은 내장 — 구분자 ':' 가 있어야 한다", () => {
    expect(toolSourceFromName("mcp_helper")).toBe("builtin");
    expect(toolSourceFromName("openapi_spec_tool")).toBe("builtin");
  });

  it("빈 이름은 내장으로 폴백한다", () => {
    expect(toolSourceFromName("")).toBe("builtin");
  });
});

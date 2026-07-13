import { describe, it, expect } from "vitest";
import type { ToolMetricEntry, ToolMetricRepo } from "@wchat/interfaces";
import { recordToolMetric } from "../tool-metrics.js";

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
});

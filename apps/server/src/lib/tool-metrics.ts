// tool-metrics.ts — 도구 호출 결과를 tool_metrics 에 기록.
//   06-DATA-MODEL.md § 0011 tool_metrics / 14-INTERFACES.md § ToolMetricRepo 단일 출처.
//   admin 대시보드(P9-T6-01) 의 tool-metrics 화면이 ToolMetricRepo.aggregate 를 직접 사용.

import type { ToolMetricEntry, ToolMetricRepo } from "@wchat/interfaces";

export async function recordToolMetric(
  repo: Pick<ToolMetricRepo, "append">,
  entry: ToolMetricEntry,
): Promise<void> {
  await repo.append(entry);
}

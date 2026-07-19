// tool-metrics.ts — 도구 호출 결과를 tool_metrics 에 기록.
//   06-DATA-MODEL.md § 0011 tool_metrics / 14-INTERFACES.md § ToolMetricRepo 단일 출처.
//   admin 대시보드(P9-T6-01) 의 tool-metrics 화면이 ToolMetricRepo.aggregate 를 직접 사용.

import type { ToolMetricEntry, ToolMetricRepo } from "@wchat/interfaces";

type ToolSource = NonNullable<ToolMetricEntry["source"]>;

/** 툴 이름 네임스페이스 → 출처. 네임스페이스 규약 단일 출처:
 *    mcp     — mcp/mcp-tool-adapter.ts `mcpToolName` = `mcp:{serverId}:{toolName}`
 *    openapi — tools/openapi-tool-adapter.ts `openApiToolName` = `openapi:{serverId}:{operationId}`
 *    skill   — `skill:{name}`. 현재 SkillRegistry 는 툴을 노출하지 않아 실사용 경로가 없지만
 *              계약(C17B) enum 에 포함돼 있어 규약을 여기서 고정한다.
 *  네임스페이스가 없으면 내장 툴(tools/assemble-builtin-tools.ts)이다.
 *  구분자 ':' 를 요구하므로 `mcp_helper` 같은 유사 이름은 builtin 으로 남는다.
 *  순수 함수 — 기록 시점(orchestrator instrumentedInvoke)에 1회 호출된다. (P22-T6-19 / C17B) */
export function toolSourceFromName(toolName: string): ToolSource {
  const separator = toolName.indexOf(":");
  if (separator <= 0) return "builtin";
  const namespace = toolName.slice(0, separator);
  if (namespace === "mcp") return "mcp";
  if (namespace === "openapi") return "openapi";
  if (namespace === "skill") return "skill";
  return "builtin";
}

export async function recordToolMetric(
  repo: Pick<ToolMetricRepo, "append">,
  entry: ToolMetricEntry,
): Promise<void> {
  await repo.append(entry);
}

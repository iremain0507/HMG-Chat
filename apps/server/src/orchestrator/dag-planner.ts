// dag-planner.ts — 의존성 DAG 플래너 + 병렬 실행(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-02):
//   서브태스크 노드(placeholder 변수 포함 task) + 의존그래프를 위상정렬(Kahn)해 레벨별로
//   실행한다. 같은 레벨(서로 독립)의 노드는 Promise.all 로 동시에 격리 runTurn 인스턴스를
//   소비하고(LLMCompiler), 레벨 간(의존관계)은 순차 실행한다. 각 노드의 결과 텍스트는 후속
//   노드의 task 안 `{{nodeId}}` placeholder 로 치환된다(ReWOO). shared-state 편집은 이 엔진의
//   범위 밖(§20.4 — 독립·read-heavy 워크로드 한정).
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  LLMMessage,
  LLMProvider,
  PromptBlock,
  ToolContext,
} from "@wchat/interfaces";
import { runTurn } from "./orchestrator.js";

export interface DagNode {
  id: string;
  task: string;
  dependsOn?: string[];
}

export interface DagPlan {
  nodes: DagNode[];
}

export interface DagRunnerOptions {
  provider: LLMProvider;
  model: string;
  systemBlocks: PromptBlock[];
  maxTokens: number;
  // 각 노드에 부여할 스코프 tool 목록 — worker 격리와 동일하게 모든 노드가 공유.
  tools?: AgentTool[];
  ctx: ToolContext;
}

const PLACEHOLDER_RE = /\{\{([\w-]+)\}\}/g;

function resolvePlaceholders(
  task: string,
  results: Map<string, string>,
): string {
  return task.replace(PLACEHOLDER_RE, (match, id: string) =>
    results.has(id) ? (results.get(id) as string) : match,
  );
}

// Kahn 위상정렬 — 같은 레벨(동시에 준비되는 노드)=서로 독립=병렬 가능.
function topologicalLevels(nodes: DagNode[]): DagNode[][] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!byId.has(dep)) {
        throw new WChatError(
          "DAG_INVALID",
          "orchestrator",
          false,
          `노드 "${node.id}" 가 존재하지 않는 의존성 "${dep}" 을 참조합니다.`,
        );
      }
    }
  }

  const remaining = new Map(byId);
  const done = new Set<string>();
  const levels: DagNode[][] = [];

  while (remaining.size > 0) {
    const level = [...remaining.values()].filter((node) =>
      (node.dependsOn ?? []).every((dep) => done.has(dep)),
    );
    if (level.length === 0) {
      throw new WChatError(
        "DAG_CYCLE",
        "orchestrator",
        false,
        `DAG 에 순환 의존성이 있습니다: ${[...remaining.keys()].join(", ")}`,
      );
    }
    for (const node of level) {
      remaining.delete(node.id);
      done.add(node.id);
    }
    levels.push(level);
  }
  return levels;
}

async function runNode(
  resolvedTask: string,
  options: DagRunnerOptions,
): Promise<string> {
  const messages: LLMMessage[] = [{ role: "user", content: resolvedTask }];
  let finalText = "";

  for await (const event of runTurn({
    provider: options.provider,
    model: options.model,
    systemBlocks: options.systemBlocks,
    messages,
    maxTokens: options.maxTokens,
    signal: options.ctx.signal,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    toolContext: {
      requestId: options.ctx.requestId,
      userId: options.ctx.userId,
      orgId: options.ctx.orgId,
      sessionId: options.ctx.sessionId,
      ...(options.ctx.projectId !== undefined
        ? { projectId: options.ctx.projectId }
        : {}),
      logger: options.ctx.logger,
      hitl: options.ctx.hitl,
      budget: options.ctx.budget,
    },
  })) {
    if (event.type === "text_delta") {
      finalText += event.text;
    }
  }
  return finalText;
}

// 목표 → 서브태스크 DAG 실행. 독립 노드(같은 레벨)는 Promise.all 로 동시에 runTurn
// AsyncIterable 을 소비하고, 의존 노드는 선행 레벨 완료 후 순차 실행된다. 반환값은
// nodeId → 압축 최종 텍스트(각 노드 내부 tool_use/tool_result 는 worker 와 동일하게
// 노출되지 않는다).
export async function runDag(
  plan: DagPlan,
  options: DagRunnerOptions,
): Promise<Map<string, string>> {
  const levels = topologicalLevels(plan.nodes);
  const results = new Map<string, string>();

  for (const level of levels) {
    const levelResults = await Promise.all(
      level.map(async (node) => {
        const resolvedTask = resolvePlaceholders(node.task, results);
        const text = await runNode(resolvedTask, options);
        return [node.id, text] as const;
      }),
    );
    for (const [id, text] of levelResults) {
      results.set(id, text);
    }
  }

  return results;
}

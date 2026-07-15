// evaluator-optimizer.ts — Evaluator-Optimizer 래퍼(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-05):
//   generator(artifact worker, 보통 P12-T2-01 createWorkerTool 산출물)를 생성기로,
//   무툴(tools 미지정) runTurn 을 평가기로 삼아 생성→평가→기준 미달 시 피드백을 반영한
//   재생성 닫힌 루프(Reflexion/Anthropic evaluator-optimizer)를 돈다. 명확한 기준(criteria)이
//   없으면 반복 개선의 전제가 성립하지 않으므로 생성 시점에 즉시 실패한다. maxIterations
//   hard cap 으로 MAST 스텝반복/미종료 실패모드를 방어(무한루프 없이 마지막 생성 결과 반환).
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";
import { runTurn } from "./orchestrator.js";
import { consumeUntilAbort } from "./consume-until-abort.js";

export interface EvaluatorVerdict {
  pass: boolean;
  feedback: string;
}

export interface EvaluatorOptimizerOptions {
  name: string;
  description: string;
  // artifact 생성기 — 보통 createWorkerTool 산출물.
  generator: AgentTool;
  evaluatorProvider: LLMProvider;
  evaluatorModel: string;
  maxTokens: number;
  // 명확한 평가 기준 — 공백만 있으면 반복개선의 전제가 없으므로 생성 시점에 즉시 실패.
  criteria: string;
  // 무한루프 방지 hard cap(MAST 스텝반복/미종료 가드). 기본 3.
  maxIterations?: number;
  onIteration?: (info: {
    iteration: number;
    verdict: EvaluatorVerdict;
  }) => void;
}

function buildEvaluatorSystemPrompt(criteria: string): string {
  return `다음 기준을 충족하는지 평가하라: ${criteria}. 응답의 첫 줄에 정확히 "PASS" 또는 "FAIL" 만 쓰고, 그 다음 줄부터 개선을 위한 피드백을 작성하라.`;
}

function parseVerdict(evaluatorText: string): EvaluatorVerdict {
  const lines = evaluatorText.trim().split("\n");
  const first = (lines[0] ?? "").trim().toUpperCase();
  const feedback = lines.slice(1).join("\n").trim();
  return { pass: first.startsWith("PASS"), feedback };
}

export function createEvaluatorOptimizerTool(
  options: EvaluatorOptimizerOptions,
): AgentTool {
  if (!options.criteria.trim()) {
    throw new WChatError(
      "EVALUATOR_CONFIG_INVALID",
      "orchestrator",
      false,
      "criteria 가 비어 있습니다 — 명확한 기준이 있을 때만 반복 개선한다.",
    );
  }

  const maxIterations = options.maxIterations ?? 3;
  const spec: AgentToolSpec = {
    name: options.name,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
    permissionTier: "tool",
    defaultPolicy: "allow",
    tags: ["read-only"],
  };

  return {
    spec,
    async invoke({ toolCallId, args, ctx }) {
      const task = typeof args.task === "string" ? args.task.trim() : "";
      if (!task) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "task 가 필요합니다.",
            ),
          },
        };
      }

      let currentTask = task;
      let lastResult = await options.generator.invoke({
        toolCallId,
        args: { task: currentTask },
        ctx,
      });

      for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        if (lastResult.content.kind !== "text") {
          return lastResult;
        }

        const evaluatorMessages: LLMMessage[] = [
          { role: "user", content: lastResult.content.text },
        ];
        let evaluatorText = "";
        const evaluatorEvents = runTurn({
          provider: options.evaluatorProvider,
          model: options.evaluatorModel,
          systemBlocks: [
            {
              tier: "system",
              content: buildEvaluatorSystemPrompt(options.criteria),
            },
          ],
          messages: evaluatorMessages,
          maxTokens: options.maxTokens,
          signal: ctx.signal,
        });
        await consumeUntilAbort(evaluatorEvents, ctx.signal, (event) => {
          if (event.type === "text_delta") {
            evaluatorText += event.text;
          }
        });

        const verdict = parseVerdict(evaluatorText);
        options.onIteration?.({ iteration, verdict });

        if (verdict.pass || iteration === maxIterations) {
          return lastResult;
        }

        currentTask = `${task}\n\n이전 시도: ${lastResult.content.text}\n\n평가 피드백: ${verdict.feedback}\n\n위 피드백을 반영해 개선하라.`;
        lastResult = await options.generator.invoke({
          toolCallId,
          args: { task: currentTask },
          ctx,
        });
      }

      return lastResult;
    },
  };
}

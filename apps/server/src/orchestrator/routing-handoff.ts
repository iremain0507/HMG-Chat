// routing-handoff.ts — Routing/Handoff 노드(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-04):
//   요청을 경량 분류 runTurn 으로 카테고리(knowledge/artifact/general 등, specialists 의 키)로
//   분류한 뒤 해당 specialist worker(AgentTool, 보통 P12-T2-01 createWorkerTool 산출물)에게
//   위임한다. 분류 결과가 알려진 카테고리와 일치하지 않으면 fallback specialist 로 위임한다.
//   handoff payload(HandoffPayload)는 orchestrator 내부 전용 타입 — ChatEvent 로 승격되지
//   않으며, onHandoff 훅(로깅 등 내부 관측용)으로만 노출된다(OpenAI Swarm 의 handoff 개념을
//   기존 tool_use/tool_result ChatEvent 위임으로 근사, 동결 계약 무변경). A2A(에이전트간
//   원격 프로토콜)는 이 태스크 범위 밖 — 격리.
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  LLMMessage,
  LLMProvider,
  PromptBlock,
} from "@wchat/interfaces";
import { runTurn } from "./orchestrator.js";
import { consumeUntilAbort } from "./consume-until-abort.js";

// orchestrator 내부 전용 타입 — ChatEvent 변형이 아니다(동결 계약 준수).
export interface HandoffPayload {
  classification: string;
  targetWorker: string;
  task: string;
}

export interface RoutingHandoffOptions {
  name: string;
  description: string;
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  // 분류 카테고리(키) → 위임 대상 specialist worker.
  specialists: Record<string, AgentTool>;
  // 분류 결과가 specialists 의 키와 일치하지 않을 때 위임할 카테고리.
  fallback: string;
  // handoff payload 관측 훅 — 내부 로깅 전용, ChatEvent 로 방출하지 않는다.
  onHandoff?: (payload: HandoffPayload) => void;
}

function buildClassifierSystemBlocks(categories: string[]): PromptBlock[] {
  return [
    {
      tier: "system",
      content: `다음 사용자 요청을 아래 카테고리 중 정확히 하나로 분류하라: ${categories.join(", ")}. 다른 말 없이 카테고리 이름 한 단어만 답하라.`,
    },
  ];
}

function resolveClassification(
  classifierText: string,
  categories: string[],
  fallback: string,
): string {
  const normalized = classifierText.trim().toLowerCase();
  const matched = categories.find((category) =>
    normalized.includes(category.toLowerCase()),
  );
  return matched ?? fallback;
}

export function createRoutingHandoffTool(
  options: RoutingHandoffOptions,
): AgentTool {
  if (!(options.fallback in options.specialists)) {
    throw new WChatError(
      "ROUTING_CONFIG_INVALID",
      "orchestrator",
      false,
      `fallback 카테고리 "${options.fallback}" 가 specialists 에 없습니다.`,
    );
  }

  const categories = Object.keys(options.specialists);
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

      const classifierMessages: LLMMessage[] = [
        { role: "user", content: task },
      ];
      let classifierText = "";
      const classifierEvents = runTurn({
        provider: options.provider,
        model: options.model,
        systemBlocks: buildClassifierSystemBlocks(categories),
        messages: classifierMessages,
        maxTokens: options.maxTokens,
        signal: ctx.signal,
      });
      await consumeUntilAbort(classifierEvents, ctx.signal, (event) => {
        if (event.type === "text_delta") {
          classifierText += event.text;
        }
      });

      const classification = resolveClassification(
        classifierText,
        categories,
        options.fallback,
      );
      const targetWorker = classification;
      const payload: HandoffPayload = { classification, targetWorker, task };
      options.onHandoff?.(payload);

      const specialist = options.specialists[targetWorker] as AgentTool;
      return specialist.invoke({ toolCallId, args: { task }, ctx });
    },
  };
}

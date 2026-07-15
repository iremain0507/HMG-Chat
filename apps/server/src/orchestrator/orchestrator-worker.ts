// orchestrator-worker.ts — Orchestrator-Worker 조합(20-MULTI-AGENT-TOOL.md §20.6/P12-T2-01):
//   worker = 격리 컨텍스트(자체 messages)+스코프 AgentTool[] 로 호출되는 runTurn 인스턴스를
//   감싼 AgentTool. worker 내부에서 발생하는 tool_use/tool_result/citation/artifact_created/
//   stop 등 중간 ChatEvent 는 전부 내부에서 소비되고, 압축된 최종 텍스트(text_delta 누적)만
//   부모 tool_result 로 반환된다(Claude subagent 모델). 부모는 이 worker 를 여느 AgentTool 과
//   동일한 tool_use/tool_result ChatEvent 로만 관찰하므로 packages/interfaces 무변경.
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  LLMMessage,
  LLMProvider,
  PromptBlock,
  ToolPolicy,
} from "@wchat/interfaces";
import { runTurn } from "./orchestrator.js";
import { consumeUntilAbort } from "./consume-until-abort.js";

export interface WorkerToolOptions {
  name: string;
  description: string;
  provider: LLMProvider;
  model: string;
  systemBlocks: PromptBlock[];
  maxTokens: number;
  // worker 에게 부여할 스코프 tool 목록 — 부모의 전체 tool 목록과 무관 (격리).
  tools?: AgentTool[];
  defaultPolicy?: ToolPolicy;
  tags?: string[];
}

export function createWorkerTool(options: WorkerToolOptions): AgentTool {
  const spec: AgentToolSpec = {
    name: options.name,
    description: options.description,
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
    },
    permissionTier: "tool",
    defaultPolicy: options.defaultPolicy ?? "allow",
    tags: options.tags ?? ["read-only"],
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

      // 부모 대화 이력을 물려받지 않는 격리 컨텍스트 — task 하나만 담은 새 messages.
      const messages: LLMMessage[] = [{ role: "user", content: task }];
      let finalText = "";

      const events = runTurn({
        provider: options.provider,
        model: options.model,
        systemBlocks: options.systemBlocks,
        messages,
        maxTokens: options.maxTokens,
        signal: ctx.signal,
        ...(options.tools !== undefined ? { tools: options.tools } : {}),
        toolContext: {
          requestId: ctx.requestId,
          userId: ctx.userId,
          orgId: ctx.orgId,
          sessionId: ctx.sessionId,
          ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
          logger: ctx.logger,
          hitl: ctx.hitl,
          budget: ctx.budget,
        },
      });
      // tool_use/tool_result/citation/artifact_created/stop/error 등 중간 이벤트는
      // 이 콜백 밖으로 나가지 않는다 — worker 격리의 핵심 불변식. consumeUntilAbort 는
      // 부모 취소 시 provider 의 signal 협조 여부와 무관하게 이 소비를 즉시 중단한다
      // (P12-T2-03 — AbortSignal fan-out).
      await consumeUntilAbort(events, ctx.signal, (event) => {
        if (event.type === "text_delta") {
          finalText += event.text;
        }
      });

      return {
        toolCallId,
        content: { kind: "text", text: finalText },
      };
    },
  };
}

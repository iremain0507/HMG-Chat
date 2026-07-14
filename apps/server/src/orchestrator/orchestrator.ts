import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolResult,
  ChatEvent,
  ContentPart,
  LLMMessage,
  LLMProvider,
  PromptBlock,
  ToolContext,
} from "@wchat/interfaces";

export function hello(): string {
  return "orchestrator: hello-world";
}

export interface RunTurnInput {
  provider: LLMProvider;
  model: string;
  systemBlocks: PromptBlock[];
  messages: LLMMessage[];
  maxTokens: number;
  signal: AbortSignal;
  tools?: AgentTool[];
  // tools 사용 시 필수 — AgentTool.invoke 에 넘길 ToolContext. signal 은
  // RunTurnInput.signal 을 그대로 쓰므로 여기 별도 필드 없음(중복 방지).
  toolContext?: Omit<ToolContext, "signal">;
}

function toToolResultContent(result: AgentToolResult): string | unknown {
  switch (result.content.kind) {
    case "text":
      return result.content.text;
    case "json":
      return result.content.data;
    case "file":
      return { artifactId: result.content.artifactId };
    case "error":
      return { error: result.content.error };
  }
}

// 메시지 → LLM → SSE 루프 (14-INTERFACES.md § 6 ChatEvent 는 16-API-CONTRACT SSE
// 이벤트와 1:1이므로, 이 async generator 를 그대로 SSE 로 relay 하면 된다).
// tools 등록 시: provider.chat 이 stop.reason==="tool_use" 로 끝나면(비종결) 해당
// tool_use 들을 실행해 tool_result 를 emit 하고, 결과를 메시지에 append 해 provider.chat
// 을 재호출한다. abort 된 경우 진행 중이던 tool 실행은 시작하지 않는다.
export async function* runTurn(input: RunTurnInput): AsyncIterable<ChatEvent> {
  const toolsByName = new Map(
    (input.tools ?? []).map((tool) => [tool.spec.name, tool]),
  );
  const toolSpecs = input.tools?.map((tool) => tool.spec);
  let messages = input.messages;

  for (;;) {
    const pendingToolUses: Extract<ChatEvent, { type: "tool_use" }>[] = [];
    const assistantParts: ContentPart[] = [];
    let stopEvent: Extract<ChatEvent, { type: "stop" }> | undefined;

    const chatEvents = input.provider.chat(
      {
        model: input.model,
        systemBlocks: input.systemBlocks,
        messages,
        maxTokens: input.maxTokens,
        ...(toolSpecs ? { tools: toolSpecs } : {}),
      },
      input.signal,
    );
    for await (const event of chatEvents) {
      yield event;
      if (event.type === "text_delta") {
        const last = assistantParts.at(-1);
        if (last?.type === "text") {
          last.text += event.text;
        } else {
          assistantParts.push({ type: "text", text: event.text });
        }
      } else if (event.type === "tool_use") {
        pendingToolUses.push(event);
        assistantParts.push({
          type: "tool_use",
          toolCallId: event.toolCallId,
          name: event.name,
          args: event.args,
        });
      } else if (event.type === "stop") {
        stopEvent = event;
      } else if (event.type === "error") {
        return;
      }
    }

    if (stopEvent?.reason !== "tool_use" || pendingToolUses.length === 0) {
      return;
    }
    if (input.signal.aborted) {
      return;
    }

    const toolResultParts: ContentPart[] = [];
    for (const toolUse of pendingToolUses) {
      const tool = toolsByName.get(toolUse.name);
      const result: AgentToolResult = tool
        ? await tool.invoke({
            toolCallId: toolUse.toolCallId,
            args: (toolUse.args ?? {}) as Record<string, unknown>,
            ctx: { ...input.toolContext!, signal: input.signal },
          })
        : {
            toolCallId: toolUse.toolCallId,
            content: {
              kind: "error",
              error: new WChatError(
                "TOOL_NOT_FOUND",
                "tool",
                false,
                `등록되지 않은 툴: ${toolUse.name}`,
              ),
            },
          };
      const content = toToolResultContent(result);
      yield { type: "tool_result", toolCallId: toolUse.toolCallId, content };
      toolResultParts.push({
        type: "tool_result",
        toolCallId: toolUse.toolCallId,
        content,
      });
    }

    messages = [
      ...messages,
      { role: "assistant", content: assistantParts },
      { role: "tool", content: toolResultParts },
    ];
  }
}

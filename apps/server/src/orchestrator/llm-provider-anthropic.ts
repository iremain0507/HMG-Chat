import type Anthropic from "@anthropic-ai/sdk";
import type {
  AgentToolSpec,
  ChatEvent,
  ChatInput,
  ContentPart,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";

// client.messages.stream() 만 필요 — 실 Anthropic SDK 의 MessageStream(EventEmitter) 대신
// 테스트 대체 가능한 최소 async-iterable 계약만 요구한다.
export interface AnthropicMessagesStreamClient {
  messages: {
    stream(
      body: Anthropic.MessageStreamParams,
      options?: { signal?: AbortSignal },
    ): AsyncIterable<Anthropic.RawMessageStreamEvent>;
  };
}

export interface CreateAnthropicLLMProviderDeps {
  client: AnthropicMessagesStreamClient;
  models?: string[];
}

const DEFAULT_MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];

function toAnthropicRole(role: LLMMessage["role"]): "user" | "assistant" {
  // Anthropic API 에는 'tool' role 이 없음 — tool_result 는 user turn 에 포함.
  return role === "assistant" ? "assistant" : "user";
}

function toAnthropicContentPart(
  part: ContentPart,
): Anthropic.ContentBlockParam {
  switch (part.type) {
    case "text":
      return { type: "text", text: part.text };
    case "tool_use":
      return {
        type: "tool_use",
        id: part.toolCallId,
        name: part.name,
        input: part.args,
      };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content:
          typeof part.content === "string"
            ? part.content
            : JSON.stringify(part.content),
      };
  }
}

function toAnthropicMessages(messages: LLMMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: toAnthropicRole(message.role),
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(toAnthropicContentPart),
  }));
}

function mapStopReason(
  reason: Anthropic.RawMessageDeltaEvent.Delta["stop_reason"],
): "end_turn" | "tool_use" | "max_tokens" {
  return reason === "tool_use" || reason === "max_tokens" ? reason : "end_turn";
}

function toAnthropicTools(tools: AgentToolSpec[]): Anthropic.Tool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

function toAnthropicToolChoice(
  toolChoice: ChatInput["toolChoice"],
  parallelToolCalls: ChatInput["parallelToolCalls"],
): Anthropic.ToolChoice | undefined {
  const disableParallel = parallelToolCalls === false;
  if (!toolChoice) {
    return disableParallel
      ? { type: "auto", disable_parallel_tool_use: true }
      : undefined;
  }
  const base =
    toolChoice === "auto"
      ? { type: "auto" as const }
      : toolChoice === "any"
        ? { type: "any" as const }
        : { type: "tool" as const, name: toolChoice.name };
  return disableParallel ? { ...base, disable_parallel_tool_use: true } : base;
}

export function createAnthropicLLMProvider(
  deps: CreateAnthropicLLMProviderDeps,
): LLMProvider {
  const { client, models = DEFAULT_MODELS } = deps;

  return {
    name: "anthropic",
    models,
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      const toolChoice = toAnthropicToolChoice(
        input.toolChoice,
        input.parallelToolCalls,
      );
      const body: Anthropic.MessageStreamParams = {
        model: input.model,
        max_tokens: input.maxTokens,
        messages: toAnthropicMessages(input.messages),
        ...(input.systemBlocks.length > 0
          ? {
              system: input.systemBlocks
                .map((block) => block.content)
                .join("\n\n"),
            }
          : {}),
        ...(input.tools && input.tools.length > 0
          ? { tools: toAnthropicTools(input.tools) }
          : {}),
        ...(toolChoice ? { tool_choice: toolChoice } : {}),
        ...(input.temperature !== undefined
          ? { temperature: input.temperature }
          : {}),
        ...(input.topP !== undefined ? { top_p: input.topP } : {}),
      };

      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";
      let toolUseBuffer:
        { toolCallId: string; name: string; json: string } | undefined;

      try {
        for await (const event of client.messages.stream(body, { signal })) {
          switch (event.type) {
            case "message_start":
              inputTokens = event.message.usage.input_tokens;
              outputTokens = event.message.usage.output_tokens;
              yield {
                type: "message_start",
                messageId: event.message.id,
                meta: { provider: "anthropic", model: event.message.model },
              };
              break;
            case "content_block_start":
              if (event.content_block.type === "tool_use") {
                toolUseBuffer = {
                  toolCallId: event.content_block.id,
                  name: event.content_block.name,
                  json: "",
                };
              }
              break;
            case "content_block_delta":
              if (event.delta.type === "text_delta") {
                yield { type: "text_delta", text: event.delta.text };
              } else if (
                event.delta.type === "input_json_delta" &&
                toolUseBuffer
              ) {
                toolUseBuffer.json += event.delta.partial_json;
              }
              break;
            case "content_block_stop":
              if (toolUseBuffer) {
                let args: Record<string, unknown> = {};
                if (toolUseBuffer.json) {
                  try {
                    args = JSON.parse(toolUseBuffer.json) as Record<
                      string,
                      unknown
                    >;
                  } catch {
                    // 잘린 partial_json — turn 을 죽이지 않고 빈 args 로 폴백.
                    args = {};
                  }
                }
                yield {
                  type: "tool_use",
                  toolCallId: toolUseBuffer.toolCallId,
                  name: toolUseBuffer.name,
                  args,
                };
                toolUseBuffer = undefined;
              }
              break;
            case "message_delta":
              outputTokens = event.usage.output_tokens;
              stopReason = mapStopReason(event.delta.stop_reason);
              break;
            case "message_stop":
              yield {
                type: "stop",
                reason: stopReason,
                usage: { inputTokens, outputTokens },
              };
              break;
          }
        }
      } catch (err) {
        if (signal.aborted) {
          yield {
            type: "stop",
            reason: "aborted",
            usage: { inputTokens: 0, outputTokens: 0 },
          };
          return;
        }
        yield {
          type: "error",
          error: {
            code: "ANTHROPIC_PROVIDER_ERROR",
            category: "external-api",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        };
      }
    },
  };
}

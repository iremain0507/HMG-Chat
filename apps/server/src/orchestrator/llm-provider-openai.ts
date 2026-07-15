import type OpenAI from "openai";
import type {
  AgentToolSpec,
  ChatEvent,
  ChatInput,
  ContentPart,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";
import {
  toOpenAIToolChoiceFormat,
  toOpenAIToolFormat,
} from "./tool-schema-codec.js";

// client.chat.completions.create({stream:true}) 만 필요 — 실 OpenAI SDK 의
// APIPromise<Stream<ChatCompletionChunk>> 대신 테스트 대체 가능한 최소 계약만 요구한다.
export interface OpenAIChatCompletionsStreamClient {
  chat: {
    completions: {
      create(
        body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        options?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>;
    };
  };
}

export interface CreateOpenAILLMProviderDeps {
  client: OpenAIChatCompletionsStreamClient;
  models?: string[];
}

const DEFAULT_MODELS = ["gpt-5.1", "gpt-5.1-mini"];

function toOpenAIContentText(parts: ContentPart[]): string {
  return parts
    .filter(
      (part): part is Extract<ContentPart, { type: "text" }> =>
        part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

function toOpenAIToolCalls(
  parts: ContentPart[],
): OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall[] {
  return parts
    .filter(
      (part): part is Extract<ContentPart, { type: "tool_use" }> =>
        part.type === "tool_use",
    )
    .map((part) => ({
      id: part.toolCallId,
      type: "function" as const,
      function: { name: part.name, arguments: JSON.stringify(part.args) },
    }));
}

// LLMMessage(role='tool', content=tool_result 파트 여러개) 는 OpenAI 에서 1 tool_result = 1
// role:'tool' 메시지로 펼쳐야 하므로(Anthropic 처럼 user turn 안에 묶을 수 없음), 1:N 변환.
function toOpenAIMessages(
  messages: LLMMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const result: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      result.push(
        message.role === "assistant"
          ? { role: "assistant", content: message.content }
          : { role: "user", content: message.content },
      );
      continue;
    }
    if (message.role === "tool") {
      for (const part of message.content) {
        if (part.type === "tool_result") {
          result.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content:
              typeof part.content === "string"
                ? part.content
                : JSON.stringify(part.content),
          });
        }
      }
      continue;
    }
    if (message.role === "assistant") {
      const text = toOpenAIContentText(message.content);
      const toolCalls = toOpenAIToolCalls(message.content);
      result.push({
        role: "assistant",
        ...(text ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }
    result.push({
      role: "user",
      content: toOpenAIContentText(message.content),
    });
  }
  return result;
}

function toOpenAITools(
  tools: AgentToolSpec[],
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  // OpenAI SDK 의 FunctionParameters 는 index-signature 를 요구해 JsonSchema(구조적 타입)와
  // 직접 호환되지 않음 — 값은 tool-schema-codec 이 그대로 산출한 것을 형변환만.
  return toOpenAIToolFormat(tools).map((tool) => ({
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters as Record<string, unknown>,
    },
  }));
}

function mapFinishReason(
  reason: OpenAI.Chat.Completions.ChatCompletionChunk.Choice["finish_reason"],
): "end_turn" | "tool_use" | "max_tokens" {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "length") return "max_tokens";
  return "end_turn";
}

interface ToolCallBuffer {
  toolCallId: string;
  name: string;
  json: string;
}

export function createOpenAILLMProvider(
  deps: CreateOpenAILLMProviderDeps,
): LLMProvider {
  const { client, models = DEFAULT_MODELS } = deps;

  return {
    name: "openai",
    models,
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      const messages = toOpenAIMessages(input.messages);
      if (input.systemBlocks.length > 0) {
        messages.unshift({
          role: "system",
          content: input.systemBlocks
            .map((block) => block.content)
            .join("\n\n"),
        });
      }
      const toolChoice = toOpenAIToolChoiceFormat(input.toolChoice);
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming =
        {
          model: input.model,
          stream: true,
          stream_options: { include_usage: true },
          messages,
          max_completion_tokens: input.maxTokens,
          ...(input.tools && input.tools.length > 0
            ? { tools: toOpenAITools(input.tools) }
            : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(input.parallelToolCalls === false
            ? { parallel_tool_calls: false }
            : {}),
        };

      let messageStarted = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let stopReason: "end_turn" | "tool_use" | "max_tokens" = "end_turn";
      const toolCallBuffers = new Map<number, ToolCallBuffer>();

      try {
        const stream = await client.chat.completions.create(body, { signal });
        for await (const chunk of stream) {
          if (!messageStarted) {
            messageStarted = true;
            yield {
              type: "message_start",
              messageId: chunk.id,
              meta: { provider: "openai", model: chunk.model },
            };
          }
          const choice = chunk.choices[0];
          if (choice?.delta.content) {
            yield { type: "text_delta", text: choice.delta.content };
          }
          if (choice?.delta.tool_calls) {
            for (const toolCall of choice.delta.tool_calls) {
              let buffer = toolCallBuffers.get(toolCall.index);
              if (!buffer) {
                buffer = { toolCallId: "", name: "", json: "" };
                toolCallBuffers.set(toolCall.index, buffer);
              }
              if (toolCall.id) buffer.toolCallId = toolCall.id;
              if (toolCall.function?.name) buffer.name = toolCall.function.name;
              if (toolCall.function?.arguments) {
                buffer.json += toolCall.function.arguments;
              }
            }
          }
          if (choice?.finish_reason) {
            stopReason = mapFinishReason(choice.finish_reason);
          }
          if (chunk.usage) {
            inputTokens = chunk.usage.prompt_tokens;
            outputTokens = chunk.usage.completion_tokens;
          }
        }

        for (const index of [...toolCallBuffers.keys()].sort((a, b) => a - b)) {
          const buffer = toolCallBuffers.get(index);
          if (!buffer) continue;
          let args: Record<string, unknown> = {};
          if (buffer.json) {
            try {
              args = JSON.parse(buffer.json) as Record<string, unknown>;
            } catch {
              // 잘린/손상된 arguments — turn 을 죽이지 않고 빈 args 로 폴백.
              args = {};
            }
          }
          yield {
            type: "tool_use",
            toolCallId: buffer.toolCallId,
            name: buffer.name,
            args,
          };
        }

        yield {
          type: "stop",
          reason: stopReason,
          usage: { inputTokens, outputTokens },
        };
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
            code: "OPENAI_PROVIDER_ERROR",
            category: "external-api",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        };
      }
    },
  };
}

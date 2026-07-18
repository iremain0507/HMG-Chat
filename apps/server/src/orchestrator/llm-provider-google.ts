import { randomUUID } from "node:crypto";
import type {
  Content,
  EnhancedGenerateContentResponse,
  FinishReason,
  GenerateContentRequest,
  GenerateContentStreamResult,
  Part,
  Tool,
} from "@google/generative-ai";
import type {
  AgentToolSpec,
  ChatEvent,
  ChatInput,
  ContentPart,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";
import {
  toGeminiToolChoiceFormat,
  toGeminiToolFormat,
} from "./tool-schema-codec.js";

// client.getGenerativeModel({model}).generateContentStream() 만 필요 — 실 @google/generative-ai
// 의 GoogleGenerativeAI(class) 대신 테스트 대체 가능한 최소 계약만 요구한다.
export interface GeminiGenerateContentStreamClient {
  getGenerativeModel(params: { model: string }): {
    generateContentStream(
      request: GenerateContentRequest,
      requestOptions?: { signal?: AbortSignal },
    ): Promise<GenerateContentStreamResult>;
  };
}

export interface CreateGoogleLLMProviderDeps {
  client: GeminiGenerateContentStreamClient;
  models?: string[];
}

const DEFAULT_MODELS = ["gemini-2.5-pro", "gemini-2.5-flash"];

function toGeminiRole(role: LLMMessage["role"]): "user" | "model" | "function" {
  if (role === "assistant") return "model";
  if (role === "tool") return "function";
  return "user";
}

// FunctionResponse.name 은 Gemini 가 요구하지만 우리 ContentPart(tool_result) 는 toolCallId 만
// 들고 있음 — 같은 conversation 안의 선행 tool_use(assistant) part 에서 이름을 역참조한다.
function toGeminiPart(
  part: ContentPart,
  toolNameByCallId: Map<string, string>,
): Part {
  switch (part.type) {
    case "text":
      return { text: part.text } as Part;
    case "tool_use":
      toolNameByCallId.set(part.toolCallId, part.name);
      return {
        functionCall: { name: part.name, args: (part.args ?? {}) as object },
      } as Part;
    case "tool_result": {
      const name = toolNameByCallId.get(part.toolCallId) ?? part.toolCallId;
      const response =
        typeof part.content === "object" && part.content !== null
          ? (part.content as Record<string, unknown>)
          : { result: part.content };
      return { functionResponse: { name, response } } as Part;
    }
  }
}

function toGeminiContents(messages: LLMMessage[]): Content[] {
  const toolNameByCallId = new Map<string, string>();
  return messages.map((message) => ({
    role: toGeminiRole(message.role),
    parts:
      typeof message.content === "string"
        ? [{ text: message.content } as Part]
        : message.content.map((part) => toGeminiPart(part, toolNameByCallId)),
  }));
}

// GeminiToolFormat.functionDeclarations[].parameters 는 JsonSchema(구조적 타입) — 실 SDK 의
// FunctionDeclarationSchema(SchemaType enum 사용)와 직접 호환되지 않아 값은 tool-schema-codec 이
// 그대로 산출한 것을 형변환만 (OpenAI 어댑터의 parameters 캐스팅과 동일 패턴).
function toGeminiTools(tools: AgentToolSpec[]): Tool[] {
  return toGeminiToolFormat(tools) as unknown as Tool[];
}

function mapFinishReason(
  reason: FinishReason | undefined,
): "end_turn" | "tool_use" | "max_tokens" {
  if (reason === "MAX_TOKENS") return "max_tokens";
  return "end_turn";
}

export function createGoogleLLMProvider(
  deps: CreateGoogleLLMProviderDeps,
): LLMProvider {
  const { client, models = DEFAULT_MODELS } = deps;

  return {
    name: "google",
    models,
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      // toGeminiToolChoiceFormat 의 mode 는 리터럴 문자열("AUTO"/"ANY") — 실 SDK 의
      // FunctionCallingMode enum(같은 문자열 값)과 구조적으로 동일하나 nominal 하게 다름.
      const toolConfig = toGeminiToolChoiceFormat(
        input.toolChoice,
      ) as GenerateContentRequest["toolConfig"];
      const request: GenerateContentRequest = {
        contents: toGeminiContents(input.messages),
        generationConfig: {
          maxOutputTokens: input.maxTokens,
          // Gemini GenerationConfig 는 topP(camelCase) 을 쓴다(OpenAI 의 top_p 와 다름).
          // org-scoped sampling 파라미터를 설정 시에만 forward(미설정 시 Gemini 기본 보존).
          ...(input.temperature !== undefined
            ? { temperature: input.temperature }
            : {}),
          ...(input.topP !== undefined ? { topP: input.topP } : {}),
        },
        ...(input.systemBlocks.length > 0
          ? {
              systemInstruction: input.systemBlocks
                .map((block) => block.content)
                .join("\n\n"),
            }
          : {}),
        ...(input.tools && input.tools.length > 0
          ? { tools: toGeminiTools(input.tools) }
          : {}),
        ...(toolConfig ? { toolConfig } : {}),
      };

      let messageStarted = false;
      let inputTokens = 0;
      let outputTokens = 0;
      let finishReason: FinishReason | undefined;
      let sawToolUse = false;

      try {
        const model = client.getGenerativeModel({ model: input.model });
        const streamResult = await model.generateContentStream(request, {
          signal,
        });
        for await (const responseChunk of streamResult.stream) {
          if (!messageStarted) {
            messageStarted = true;
            yield {
              type: "message_start",
              messageId: randomUUID(),
              meta: { provider: "google", model: input.model },
            };
          }
          const candidate = (responseChunk as EnhancedGenerateContentResponse)
            .candidates?.[0];
          for (const part of candidate?.content.parts ?? []) {
            if (part.text) {
              yield { type: "text_delta", text: part.text };
            } else if (part.functionCall) {
              sawToolUse = true;
              yield {
                type: "tool_use",
                toolCallId: randomUUID(),
                name: part.functionCall.name,
                args: part.functionCall.args,
              };
            }
          }
          if (candidate?.finishReason) finishReason = candidate.finishReason;
          if (responseChunk.usageMetadata) {
            inputTokens = responseChunk.usageMetadata.promptTokenCount;
            outputTokens = responseChunk.usageMetadata.candidatesTokenCount;
          }
        }

        yield {
          type: "stop",
          reason: sawToolUse ? "tool_use" : mapFinishReason(finishReason),
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
            code: "GOOGLE_PROVIDER_ERROR",
            category: "external-api",
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        };
      }
    },
  };
}

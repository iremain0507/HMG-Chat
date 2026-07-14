import { describe, it, expect } from "vitest";
import type {
  EnhancedGenerateContentResponse,
  GenerateContentRequest,
  GenerateContentStreamResult,
} from "@google/generative-ai";
import {
  createGoogleLLMProvider,
  type GeminiGenerateContentStreamClient,
} from "../llm-provider-google.js";

function chunk(
  partial: Partial<EnhancedGenerateContentResponse>,
): EnhancedGenerateContentResponse {
  return {
    text: () => "",
    functionCall: () => undefined,
    functionCalls: () => undefined,
    ...partial,
  } as EnhancedGenerateContentResponse;
}

function fakeClient(
  chunks: EnhancedGenerateContentResponse[],
  opts?: { throwError?: unknown },
): {
  client: GeminiGenerateContentStreamClient;
  receivedRequest: () => GenerateContentRequest | undefined;
  receivedModel: () => string | undefined;
  receivedSignal: () => AbortSignal | undefined;
} {
  let request: GenerateContentRequest | undefined;
  let model: string | undefined;
  let signal: AbortSignal | undefined;
  return {
    client: {
      getGenerativeModel(params) {
        model = params.model;
        return {
          async generateContentStream(
            req,
            requestOptions,
          ): Promise<GenerateContentStreamResult> {
            request = req;
            signal = requestOptions?.signal;
            if (opts?.throwError) throw opts.throwError;
            return {
              stream: (async function* () {
                for (const c of chunks) yield c;
              })(),
              response: Promise.resolve(chunks[chunks.length - 1] ?? chunk({})),
            };
          },
        };
      },
    },
    receivedRequest: () => request,
    receivedModel: () => model,
    receivedSignal: () => signal,
  };
}

describe("createGoogleLLMProvider", () => {
  it("name/models — LLMProvider 계약을 만족한다", () => {
    const { client } = fakeClient([]);
    const provider = createGoogleLLMProvider({ client });
    expect(provider.name).toBe("google");
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("text 스트림: candidates[0].content.parts(text) 를 ChatEvent message_start/text_delta*/stop(end_turn) 으로 변환한다", async () => {
    const chunks = [
      chunk({
        candidates: [
          {
            index: 0,
            content: { role: "model", parts: [{ text: "hello" }] },
          },
        ],
      }),
      chunk({
        candidates: [
          {
            index: 0,
            content: { role: "model", parts: [{ text: " world" }] },
            finishReason: "STOP" as never,
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }),
    ];
    const { client, receivedRequest, receivedSignal } = fakeClient(chunks);
    const provider = createGoogleLLMProvider({ client });
    const controller = new AbortController();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [{ tier: "system", content: "시스템 규칙" }],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 1024,
      },
      controller.signal,
    )) {
      result.push(event);
    }

    expect(result[0]).toMatchObject({
      type: "message_start",
      meta: { provider: "google", model: "gemini-2.5-pro" },
    });
    expect(result.slice(1)).toEqual([
      { type: "text_delta", text: "hello" },
      { type: "text_delta", text: " world" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    expect(receivedRequest()?.systemInstruction).toBe("시스템 규칙");
    expect(receivedRequest()?.contents).toEqual([
      { role: "user", parts: [{ text: "안녕" }] },
    ]);
    expect(receivedRequest()?.generationConfig?.maxOutputTokens).toBe(1024);
    expect(receivedSignal()).toBe(controller.signal);
  });

  it("functionCall 파트를 ChatEvent tool_use(정규화된 args) 로 emit 하고 stop reason='tool_use' 를 전달한다", async () => {
    const chunks = [
      chunk({
        candidates: [
          {
            index: 0,
            content: {
              role: "model",
              parts: [{ functionCall: { name: "bash", args: { cmd: "ls" } } }],
            },
            finishReason: "STOP" as never,
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 8,
          totalTokenCount: 20,
        },
      }),
    ];
    const { client } = fakeClient(chunks);
    const provider = createGoogleLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [{ role: "user", content: "ls 실행해줘" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      result.push(event);
    }

    expect(result[0].type).toBe("message_start");
    expect(result[1]).toMatchObject({
      type: "tool_use",
      name: "bash",
      args: { cmd: "ls" },
    });
    expect(typeof (result[1] as { toolCallId: string }).toolCallId).toBe(
      "string",
    );
    expect(
      (result[1] as { toolCallId: string }).toolCallId.length,
    ).toBeGreaterThan(0);
    expect(result[2]).toEqual({
      type: "stop",
      reason: "tool_use",
      usage: { inputTokens: 12, outputTokens: 8 },
    });
  });

  it("client 가 에러를 던지면 ChatEvent error 로 변환해 emit 한다", async () => {
    const { client } = fakeClient([], {
      throwError: new Error("network 실패"),
    });
    const provider = createGoogleLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      result.push(event);
    }

    expect(result).toEqual([
      {
        type: "error",
        error: {
          code: "GOOGLE_PROVIDER_ERROR",
          category: "external-api",
          message: "network 실패",
          retryable: false,
        },
      },
    ]);
  });

  it("signal 이 abort 된 상태에서 에러가 나면 stop reason='aborted' 를 emit 한다", async () => {
    const controller = new AbortController();
    const { client } = fakeClient([], { throwError: new Error("aborted") });
    const provider = createGoogleLLMProvider({ client });
    controller.abort();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
      },
      controller.signal,
    )) {
      result.push(event);
    }

    expect(result).toEqual([
      {
        type: "stop",
        reason: "aborted",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);
  });

  it("input.tools 를 tool-schema-codec(toGeminiToolFormat) 으로 변환해 request.tools 에 싣는다", async () => {
    const { client, receivedRequest } = fakeClient([]);
    const provider = createGoogleLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [{ role: "user", content: "ls 실행해줘" }],
        maxTokens: 512,
        tools: [
          {
            name: "bash",
            description: "쉘 명령 실행",
            inputSchema: {
              type: "object",
              properties: { cmd: { type: "string" } },
              required: ["cmd"],
            },
            permissionTier: "system",
            defaultPolicy: "hitl",
          },
        ],
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedRequest()?.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "bash",
            description: "쉘 명령 실행",
            parameters: {
              type: "object",
              properties: { cmd: { type: "string" } },
              required: ["cmd"],
            },
          },
        ],
      },
    ]);
  });

  it("input.toolChoice 'any' 를 request.toolConfig.functionCallingConfig.mode='ANY' 로 변환한다(tool-schema-codec)", async () => {
    const { client, receivedRequest } = fakeClient([]);
    const provider = createGoogleLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        toolChoice: "any",
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedRequest()?.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
  });

  it("LLMMessage(role='assistant', content=[text,tool_use]) 를 model role(text+functionCall)로, role='tool' 을 function role(functionResponse, name 은 toolCallId→name 역참조)로 변환한다", async () => {
    const { client, receivedRequest } = fakeClient([]);
    const provider = createGoogleLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [
          { role: "user", content: "ls 실행해줘" },
          {
            role: "assistant",
            content: [
              { type: "text", text: "실행할게요" },
              {
                type: "tool_use",
                toolCallId: "call_1",
                name: "bash",
                args: { cmd: "ls" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              { type: "tool_result", toolCallId: "call_1", content: "a.txt" },
            ],
          },
        ],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedRequest()?.contents).toEqual([
      { role: "user", parts: [{ text: "ls 실행해줘" }] },
      {
        role: "model",
        parts: [
          { text: "실행할게요" },
          { functionCall: { name: "bash", args: { cmd: "ls" } } },
        ],
      },
      {
        role: "function",
        parts: [
          { functionResponse: { name: "bash", response: { result: "a.txt" } } },
        ],
      },
    ]);
  });
});

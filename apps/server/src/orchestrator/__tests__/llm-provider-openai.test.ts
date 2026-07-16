import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import {
  createOpenAILLMProvider,
  type OpenAIChatCompletionsStreamClient,
} from "../llm-provider-openai.js";

function fakeClient(
  chunks: OpenAI.Chat.Completions.ChatCompletionChunk[],
  opts?: { throwError?: unknown },
): {
  client: OpenAIChatCompletionsStreamClient;
  receivedBody: () =>
    OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming | undefined;
  receivedSignal: () => AbortSignal | undefined;
} {
  let body:
    OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming | undefined;
  let signal: AbortSignal | undefined;
  return {
    client: {
      chat: {
        completions: {
          async create(streamBody, options) {
            body = streamBody;
            signal = options?.signal;
            if (opts?.throwError) throw opts.throwError;
            return (async function* () {
              for (const chunk of chunks) {
                yield chunk;
              }
            })();
          },
        },
      },
    },
    receivedBody: () => body,
    receivedSignal: () => signal,
  };
}

function textChunk(
  id: string,
  content: string | null,
  extra?: Partial<OpenAI.Chat.Completions.ChatCompletionChunk.Choice>,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-5.1",
    choices: [
      {
        index: 0,
        delta: content === null ? {} : { content },
        finish_reason: null,
        logprobs: null,
        ...extra,
      },
    ],
  };
}

describe("createOpenAILLMProvider", () => {
  it("name/models — LLMProvider 계약을 만족한다", () => {
    const { client } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });
    expect(provider.name).toBe("openai");
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("text 스트림: delta.content* + finish_reason='stop' 을 ChatEvent message_start/text_delta*/stop(end_turn) 으로 변환한다", async () => {
    const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [
      textChunk("chatcmpl_1", "hello"),
      textChunk("chatcmpl_1", " world"),
      textChunk("chatcmpl_1", null, { finish_reason: "stop" }),
      {
        id: "chatcmpl_1",
        object: "chat.completion.chunk",
        created: 0,
        model: "gpt-5.1",
        choices: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      },
    ];
    const { client, receivedBody, receivedSignal } = fakeClient(chunks);
    const provider = createOpenAILLMProvider({ client });
    const controller = new AbortController();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [{ tier: "system", content: "시스템 규칙" }],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 1024,
      },
      controller.signal,
    )) {
      result.push(event);
    }

    expect(result).toEqual([
      {
        type: "message_start",
        messageId: "chatcmpl_1",
        meta: { provider: "openai", model: "gpt-5.1" },
      },
      { type: "text_delta", text: "hello" },
      { type: "text_delta", text: " world" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    expect(receivedBody()?.model).toBe("gpt-5.1");
    expect(receivedBody()?.messages[0]).toEqual({
      role: "system",
      content: "시스템 규칙",
    });
    expect(receivedBody()?.messages[1]).toEqual({
      role: "user",
      content: "안녕",
    });
    expect(receivedBody()?.max_completion_tokens).toBe(1024);
    expect(receivedSignal()).toBe(controller.signal);
  });

  it("tool_calls 스트림: delta.tool_calls(index 별 누적) 를 ChatEvent tool_use(args 파싱됨) 로 emit 하고 stop reason='tool_use' 를 전달한다", async () => {
    const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [
      textChunk("chatcmpl_2", null, {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "bash", arguments: "" },
            },
          ],
        },
      }),
      textChunk("chatcmpl_2", null, {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '{"cmd":' } }],
        },
      }),
      textChunk("chatcmpl_2", null, {
        delta: {
          tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }],
        },
      }),
      textChunk("chatcmpl_2", null, { finish_reason: "tool_calls" }),
      {
        id: "chatcmpl_2",
        object: "chat.completion.chunk",
        created: 0,
        model: "gpt-5.1",
        choices: [],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      },
    ];
    const { client } = fakeClient(chunks);
    const provider = createOpenAILLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "ls 실행해줘" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      result.push(event);
    }

    expect(result).toEqual([
      {
        type: "message_start",
        messageId: "chatcmpl_2",
        meta: { provider: "openai", model: "gpt-5.1" },
      },
      {
        type: "tool_use",
        toolCallId: "call_1",
        name: "bash",
        args: { cmd: "ls" },
      },
      {
        type: "stop",
        reason: "tool_use",
        usage: { inputTokens: 12, outputTokens: 8 },
      },
    ]);
  });

  it("client.chat.completions.create 가 에러를 던지면 ChatEvent error 로 변환해 emit 한다", async () => {
    const { client } = fakeClient([], {
      throwError: new Error("network 실패"),
    });
    const provider = createOpenAILLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
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
          code: "OPENAI_PROVIDER_ERROR",
          category: "external-api",
          message: "network 실패",
          retryable: false,
        },
      },
    ]);
  });

  it("input.tools 를 tool-schema-codec(toOpenAIToolFormat) 으로 변환해 body.tools 에 싣는다", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
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

    expect(receivedBody()?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "bash",
          description: "쉘 명령 실행",
          parameters: {
            type: "object",
            properties: { cmd: { type: "string" } },
            required: ["cmd"],
          },
        },
      },
    ]);
  });

  it("input.toolChoice 'any' 를 body.tool_choice='required' 로 변환한다(tool-schema-codec)", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        toolChoice: "any",
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.tool_choice).toBe("required");
  });

  it("parallelToolCalls===false 면 body.parallel_tool_calls=false 를 세팅한다", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        parallelToolCalls: false,
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.parallel_tool_calls).toBe(false);
  });

  it("input.temperature/topP 를 body.temperature/top_p 로 전달한다(P15-T2-01)", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        temperature: 0.2,
        topP: 0.5,
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.temperature).toBe(0.2);
    expect(receivedBody()?.top_p).toBe(0.5);
  });

  it("input.temperature/topP 미설정 시 body 에 해당 키를 넣지 않는다(SDK/provider 기본 유지)", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()).not.toHaveProperty("temperature");
    expect(receivedBody()).not.toHaveProperty("top_p");
  });

  it("잘린/손상된 tool_calls arguments(invalid JSON) 은 args={} 로 안전하게 폴백하고 turn 을 안 죽인다", async () => {
    const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [
      textChunk("chatcmpl_3", null, {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_2",
              type: "function",
              function: { name: "bash", arguments: '{"cmd":"l' },
            },
          ],
        },
      }),
      textChunk("chatcmpl_3", null, { finish_reason: "tool_calls" }),
    ];
    const { client } = fakeClient(chunks);
    const provider = createOpenAILLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
        systemBlocks: [],
        messages: [{ role: "user", content: "ls 실행해줘" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      result.push(event);
    }

    expect(result).toEqual([
      {
        type: "message_start",
        messageId: "chatcmpl_3",
        meta: { provider: "openai", model: "gpt-5.1" },
      },
      {
        type: "tool_use",
        toolCallId: "call_2",
        name: "bash",
        args: {},
      },
      {
        type: "stop",
        reason: "tool_use",
        usage: { inputTokens: 0, outputTokens: 0 },
      },
    ]);
  });

  it("signal 이 abort 된 상태에서 create 실행 중 에러가 나면 stop reason='aborted' 를 emit 한다", async () => {
    const controller = new AbortController();
    const { client } = fakeClient([], { throwError: new Error("aborted") });
    const provider = createOpenAILLMProvider({ client });
    controller.abort();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
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

  it("LLMMessage(role='assistant', content=[text,tool_use]) 를 assistant content+tool_calls 로, role='tool' 을 1 tool_result=1 tool 메시지로 변환한다", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createOpenAILLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "gpt-5.1",
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

    expect(receivedBody()?.messages).toEqual([
      { role: "user", content: "ls 실행해줘" },
      {
        role: "assistant",
        content: "실행할게요",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "bash", arguments: '{"cmd":"ls"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "a.txt" },
    ]);
  });
});

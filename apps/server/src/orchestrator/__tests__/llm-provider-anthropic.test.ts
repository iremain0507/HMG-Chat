import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createAnthropicLLMProvider,
  type AnthropicMessagesStreamClient,
} from "../llm-provider-anthropic.js";

function fakeClient(
  events: Anthropic.RawMessageStreamEvent[],
  opts?: { throwError?: unknown },
): {
  client: AnthropicMessagesStreamClient;
  receivedBody: () => Anthropic.MessageStreamParams | undefined;
  receivedSignal: () => AbortSignal | undefined;
} {
  let body: Anthropic.MessageStreamParams | undefined;
  let signal: AbortSignal | undefined;
  return {
    client: {
      messages: {
        async *stream(streamBody, options) {
          body = streamBody;
          signal = options?.signal;
          if (opts?.throwError) throw opts.throwError;
          for (const event of events) {
            yield event;
          }
        },
      },
    },
    receivedBody: () => body,
    receivedSignal: () => signal,
  };
}

const USAGE = {
  input_tokens: 10,
  output_tokens: 0,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
};

describe("createAnthropicLLMProvider", () => {
  it("name/models — LLMProvider 계약을 만족한다", () => {
    const { client } = fakeClient([]);
    const provider = createAnthropicLLMProvider({ client });
    expect(provider.name).toBe("anthropic");
    expect(provider.models.length).toBeGreaterThan(0);
  });

  it("text 스트림: message_start/content_block_delta(text_delta)*/message_stop 을 ChatEvent message_start/text_delta*/stop(end_turn) 으로 변환한다", async () => {
    const events: Anthropic.RawMessageStreamEvent[] = [
      {
        type: "message_start",
        message: {
          id: "msg_123",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: USAGE,
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "", citations: null },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: " world" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ];
    const { client, receivedBody, receivedSignal } = fakeClient(events);
    const provider = createAnthropicLLMProvider({ client });
    const controller = new AbortController();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
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
        messageId: "msg_123",
        meta: { provider: "anthropic", model: "claude-sonnet-4-6" },
      },
      { type: "text_delta", text: "hello" },
      { type: "text_delta", text: " world" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 10, outputTokens: 5 },
      },
    ]);
    expect(receivedBody()?.model).toBe("claude-sonnet-4-6");
    expect(receivedBody()?.system).toBe("시스템 규칙");
    expect(receivedBody()?.messages).toEqual([
      { role: "user", content: "안녕" },
    ]);
    expect(receivedBody()?.max_tokens).toBe(1024);
    expect(receivedSignal()).toBe(controller.signal);
  });

  it("tool_use 스트림: content_block_start(tool_use)+input_json_delta* 를 누적해 ChatEvent tool_use(args 파싱됨) 로 emit 하고 stop reason='tool_use' 를 전달한다", async () => {
    const events: Anthropic.RawMessageStreamEvent[] = [
      {
        type: "message_start",
        message: {
          id: "msg_456",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: USAGE,
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call_1",
          name: "bash",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"cmd":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"ls"}' },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 8 },
      },
      { type: "message_stop" },
    ];
    const { client } = fakeClient(events);
    const provider = createAnthropicLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
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
        messageId: "msg_456",
        meta: { provider: "anthropic", model: "claude-sonnet-4-6" },
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
        usage: { inputTokens: 10, outputTokens: 8 },
      },
    ]);
  });

  it("client.messages.stream 이 에러를 던지면 ChatEvent error 로 변환해 emit 한다", async () => {
    const { client } = fakeClient([], {
      throwError: new Error("network 실패"),
    });
    const provider = createAnthropicLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
      },
      new AbortController().signal,
    )) {
      result.push(event);
    }

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "error",
      error: {
        code: "ANTHROPIC_PROVIDER_ERROR",
        category: "external-api",
        message: "network 실패",
        retryable: false,
      },
    });
  });

  it("input.tools 를 body.tools 로 변환한다(inputSchema→input_schema)", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createAnthropicLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
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
      result.push(event);
    }

    expect(receivedBody()?.tools).toEqual([
      {
        name: "bash",
        description: "쉘 명령 실행",
        input_schema: {
          type: "object",
          properties: { cmd: { type: "string" } },
          required: ["cmd"],
        },
      },
    ]);
  });

  it("input.toolChoice 'any' 를 body.tool_choice={type:'any'} 로 변환한다", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createAnthropicLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        toolChoice: "any",
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.tool_choice).toEqual({ type: "any" });
  });

  it("input.toolChoice {type:'tool',name} 를 body.tool_choice={type:'tool',name} 로 변환한다", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createAnthropicLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        toolChoice: { type: "tool", name: "bash" },
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.tool_choice).toEqual({
      type: "tool",
      name: "bash",
    });
  });

  it("parallelToolCalls===false 면 tool_choice.disable_parallel_tool_use=true 를 세팅한다(toolChoice 미지정 시 auto 기본값에 병합)", async () => {
    const { client, receivedBody } = fakeClient([]);
    const provider = createAnthropicLLMProvider({ client });

    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
        systemBlocks: [],
        messages: [{ role: "user", content: "안녕" }],
        maxTokens: 512,
        tools: [
          {
            name: "bash",
            description: "쉘 명령 실행",
            inputSchema: { type: "object" },
            permissionTier: "system",
            defaultPolicy: "hitl",
          },
        ],
        parallelToolCalls: false,
      },
      new AbortController().signal,
    )) {
      void event;
    }

    expect(receivedBody()?.tool_choice).toEqual({
      type: "auto",
      disable_parallel_tool_use: true,
    });
  });

  it("잘린 partial_json(invalid JSON) 은 tool_use args={} 로 안전하게 폴백하고 turn 을 안 죽인다", async () => {
    const events: Anthropic.RawMessageStreamEvent[] = [
      {
        type: "message_start",
        message: {
          id: "msg_789",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: USAGE,
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: {
          type: "tool_use",
          id: "call_2",
          name: "bash",
          input: {},
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"cmd":"l' },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 8 },
      },
      { type: "message_stop" },
    ];
    const { client } = fakeClient(events);
    const provider = createAnthropicLLMProvider({ client });

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
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
        messageId: "msg_789",
        meta: { provider: "anthropic", model: "claude-sonnet-4-6" },
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
        usage: { inputTokens: 10, outputTokens: 8 },
      },
    ]);
  });

  it("signal 이 abort 된 상태에서 stream 실행 중 에러가 나면 stop reason='aborted' 를 emit 한다", async () => {
    const controller = new AbortController();
    const { client } = fakeClient([], { throwError: new Error("aborted") });
    const provider = createAnthropicLLMProvider({ client });
    controller.abort();

    const result = [];
    for await (const event of provider.chat(
      {
        model: "claude-sonnet-4-6",
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
});

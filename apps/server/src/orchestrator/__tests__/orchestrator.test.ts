import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ChatEvent,
  ChatInput,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { hello, runTurn } from "../orchestrator.js";

function fakeToolContext(): ToolContext {
  const logger: ToolContext["logger"] = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  };
  return {
    requestId: "req-1",
    userId: "user-1",
    orgId: "org-1",
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger,
    hitl: {
      async askApproval() {
        return { kind: "approved" };
      },
    },
    budget: {
      async claim() {},
      async settle() {},
      async refund() {},
      remaining: Infinity,
    },
  };
}

describe("orchestrator.hello", () => {
  it("도메인 진입점이 hello-world 문자열을 반환한다", () => {
    expect(hello()).toBe("orchestrator: hello-world");
  });
});

describe("orchestrator.runTurn — 메시지 → LLM → SSE 흐름", () => {
  it("사용자 메시지를 LLMProvider.chat 에 그대로 전달하고, 스트리밍된 ChatEvent 를 순서대로 그대로 emit 한다", async () => {
    const emitted: ChatEvent[] = [
      {
        type: "message_start",
        messageId: "msg-1",
        meta: { provider: "fake", model: "fake-model" },
      },
      { type: "text_delta", text: "hello" },
      { type: "text_delta", text: " world" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 3, outputTokens: 2 },
      },
    ];
    let receivedInput: ChatInput | undefined;
    let receivedSignal: AbortSignal | undefined;
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input, signal) {
        receivedInput = input;
        receivedSignal = signal;
        for (const event of emitted) {
          yield event;
        }
      },
    };

    const controller = new AbortController();
    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [{ tier: "system", content: "시스템 규칙" }],
      messages: [{ role: "user", content: "안녕" }],
      maxTokens: 1024,
      signal: controller.signal,
    })) {
      result.push(event);
    }

    expect(result).toEqual(emitted);
    expect(receivedInput?.model).toBe("fake-model");
    expect(receivedInput?.messages).toEqual([
      { role: "user", content: "안녕" },
    ]);
    expect(receivedInput?.systemBlocks).toEqual([
      { tier: "system", content: "시스템 규칙" },
    ]);
    expect(receivedInput?.maxTokens).toBe(1024);
    expect(receivedSignal).toBe(controller.signal);
  });

  it("provider.chat 이 error ChatEvent 를 emit 하면 그대로 전파한다", async () => {
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        const event: ChatEvent = {
          type: "error",
          error: {
            category: "orchestrator",
            message: "provider 실패",
            code: "PROVIDER_ERROR",
            retryable: false,
          },
        };
        yield event;
      },
    };

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "안녕" }],
      maxTokens: 512,
      signal: new AbortController().signal,
    })) {
      result.push(event);
    }

    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("error");
  });
});

describe("orchestrator.runTurn — tool-execution 루프", () => {
  it("tool_use 이후 등록된 툴을 실행하고 tool_result emit 후 모델을 재호출해 최종 text 로 마무리한다", async () => {
    const calls: ChatInput[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        if (calls.length === 1) {
          yield {
            type: "message_start",
            messageId: "msg-1",
            meta: { provider: "fake", model: "fake-model" },
          };
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "test_tool",
            args: { x: 1 },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { type: "text_delta", text: "done" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };

    const invokeArgs: unknown[] = [];
    const fakeTool: AgentTool = {
      spec: {
        name: "test_tool",
        description: "테스트 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        invokeArgs.push(input.args);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "tool-output" },
        };
      },
    };

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [fakeTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "message_start",
      "tool_use",
      "stop",
      "tool_result",
      "text_delta",
      "stop",
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.tools).toEqual([
      {
        name: "test_tool",
        description: "테스트 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "allow",
      },
    ]);
    expect(invokeArgs).toEqual([{ x: 1 }]);
    const toolResultEvent = result.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      toolCallId: "call-1",
      content: "tool-output",
    });
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            toolCallId: "call-1",
            name: "test_tool",
            args: { x: 1 },
          },
        ],
      },
      {
        role: "tool",
        content: [
          { type: "tool_result", toolCallId: "call-1", content: "tool-output" },
        ],
      },
    ]);
  });

  it("abort 시 pending tool 실행 없이 즉시 중단한다", async () => {
    const controller = new AbortController();
    let toolInvoked = false;
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        yield {
          type: "tool_use",
          toolCallId: "call-1",
          name: "test_tool",
          args: {},
        };
        controller.abort();
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const fakeTool: AgentTool = {
      spec: {
        name: "test_tool",
        description: "테스트 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        toolInvoked = true;
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "x" },
        };
      },
    };

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: controller.signal,
      tools: [fakeTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(toolInvoked).toBe(false);
    expect(result.map((e) => e.type)).toEqual(["tool_use", "stop"]);
  });
});

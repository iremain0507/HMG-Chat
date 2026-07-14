import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ChatEvent,
  ChatInput,
  HitlBridge,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { hello, runTurn } from "../orchestrator.js";

function fakeToolContext(hitl?: HitlBridge): ToolContext {
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
    hitl: hitl ?? {
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

describe("orchestrator.runTurn — HITL 게이팅 (P10-T2-02)", () => {
  function fakeHitlTool(): { tool: AgentTool; invoked: unknown[] } {
    const invoked: unknown[] = [];
    const tool: AgentTool = {
      spec: {
        name: "gated_tool",
        description: "부수효과 있는 위험 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "hitl",
      },
      async invoke(input) {
        invoked.push(input.args);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "gated-output" },
        };
      },
    };
    return { tool, invoked };
  }

  function twoLegProvider(): { provider: LLMProvider; calls: ChatInput[] } {
    const calls: ChatInput[] = [];
    const provider: LLMProvider = {
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
            name: "gated_tool",
            args: { x: 1 },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { type: "text_delta", text: "후속 응답" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };
    return { provider, calls };
  }

  it("defaultPolicy='hitl' 툴은 tool_use 를 즉시 emit 하지 않고 hitl_request 후 pause, approved 시 tool_use→invoke→tool_result 순으로 재개한다", async () => {
    const { tool: gatedTool, invoked } = fakeHitlTool();
    const { provider: fakeProvider, calls } = twoLegProvider();
    const askApprovalArgs: unknown[] = [];
    const hitl: HitlBridge = {
      async askApproval(input) {
        askApprovalArgs.push(input);
        return { kind: "approved", modifiedArgs: { x: 2 } };
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
      tools: [gatedTool],
      toolContext: fakeToolContext(hitl),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "message_start",
      "stop",
      "hitl_request",
      "hitl_resolved",
      "tool_use",
      "tool_result",
      "text_delta",
      "stop",
    ]);
    expect(askApprovalArgs).toEqual([
      expect.objectContaining({
        sessionId: "session-1",
        toolCallId: "call-1",
        toolName: "gated_tool",
        args: { x: 1 },
      }),
    ]);
    const hitlRequest = result.find((e) => e.type === "hitl_request");
    expect(hitlRequest).toMatchObject({
      toolCallId: "call-1",
      toolName: "gated_tool",
      args: { x: 1 },
    });
    const hitlResolved = result.find((e) => e.type === "hitl_resolved");
    expect(hitlResolved).toMatchObject({
      toolCallId: "call-1",
      decision: "approved",
      modifiedArgs: { x: 2 },
    });
    const toolUseEvent = result.find((e) => e.type === "tool_use");
    expect(toolUseEvent).toMatchObject({
      toolCallId: "call-1",
      name: "gated_tool",
      args: { x: 2 },
    });
    // 승인 후 invoke 는 modifiedArgs 를 사용한다.
    expect(invoked).toEqual([{ x: 2 }]);
    expect(calls).toHaveLength(2);
  });

  it("denied 시 tool_use/tool_result 를 emit 하지 않고 invoke 를 스킵, 모델이 후속 응답을 생성한다", async () => {
    const { tool: gatedTool, invoked } = fakeHitlTool();
    const { provider: fakeProvider, calls } = twoLegProvider();
    const hitl: HitlBridge = {
      async askApproval() {
        return { kind: "denied", reason: "위험함" };
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
      tools: [gatedTool],
      toolContext: fakeToolContext(hitl),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "message_start",
      "stop",
      "hitl_request",
      "hitl_resolved",
      "text_delta",
      "stop",
    ]);
    const hitlResolved = result.find((e) => e.type === "hitl_resolved");
    expect(hitlResolved).toMatchObject({
      toolCallId: "call-1",
      decision: "denied",
      reason: "위험함",
    });
    expect(invoked).toEqual([]);
    // 두번째 leg 재호출 시에도 tool_use/tool_result 페어링이 메시지 히스토리에 남는다.
    expect(calls[1]?.messages.at(-1)).toMatchObject({ role: "tool" });
  });

  it("timeout 시 hitl_timeout 만 emit 하고 invoke 를 스킵한다", async () => {
    const { tool: gatedTool, invoked } = fakeHitlTool();
    const { provider: fakeProvider } = twoLegProvider();
    const hitl: HitlBridge = {
      async askApproval() {
        return { kind: "timeout" };
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
      tools: [gatedTool],
      toolContext: fakeToolContext(hitl),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "message_start",
      "stop",
      "hitl_request",
      "hitl_timeout",
      "text_delta",
      "stop",
    ]);
    expect(invoked).toEqual([]);
  });
});

describe("orchestrator.runTurn — knowledge_search citation emit (P10-T2-03)", () => {
  it("검색 툴이 citations 를 담은 json 결과를 반환하면 tool_result 뒤에 citation 이벤트를 index/filename/snippet 과 함께 emit 한다", async () => {
    const calls: ChatInput[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        if (calls.length === 1) {
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "knowledge_search",
            args: { query: "widget" },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield {
          type: "text_delta",
          text: "widget 은 [1] 에 설명되어 있습니다",
        };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };

    const knowledgeSearchTool: AgentTool = {
      spec: {
        name: "knowledge_search",
        description: "문서 검색",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: {
            kind: "json",
            data: {
              citations: [
                {
                  index: 1,
                  source: "project",
                  documentId: "doc-1",
                  filename: "widget-guide.pdf",
                  snippet: "widget 사용법...",
                },
              ],
              message: null,
            },
          },
        };
      },
    };

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "widget 이 뭐야" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [knowledgeSearchTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "tool_use",
      "stop",
      "tool_result",
      "citation",
      "text_delta",
      "stop",
    ]);
    const citationEvent = result.find((e) => e.type === "citation");
    expect(citationEvent).toMatchObject({
      type: "citation",
      index: 1,
      source: "project",
      documentId: "doc-1",
      filename: "widget-guide.pdf",
      snippet: "widget 사용법...",
    });
  });

  it("tool json 결과에 citations 배열이 없으면 citation 이벤트를 emit 하지 않는다", async () => {
    let calls = 0;
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        calls += 1;
        if (calls === 1) {
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "other_tool",
            args: {},
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
    const otherTool: AgentTool = {
      spec: {
        name: "other_tool",
        description: "기타",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: { kind: "json", data: { ok: true } },
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
      tools: [otherTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "tool_use",
      "stop",
      "tool_result",
      "text_delta",
      "stop",
    ]);
  });
});

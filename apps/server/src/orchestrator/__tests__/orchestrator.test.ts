import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ChatEvent,
  ChatInput,
  HitlBridge,
  LLMProvider,
  Logger,
  LogPayload,
  ToolContext,
  ToolMetricEntry,
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
  it("툴이 ctx.emitProgress 로 방출한 진행상태를 부모 toolCallId 의 tool_progress 로 tool_result 이전에 relay 한다", async () => {
    const calls: ChatInput[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        if (calls.length === 1) {
          yield {
            type: "message_start",
            messageId: "m1",
            meta: { provider: "fake", model: "fake-model" },
          };
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "prog_tool",
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
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const progTool: AgentTool = {
      spec: {
        name: "prog_tool",
        description: "진행 방출 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        input.ctx.emitProgress?.({
          stage: "researching",
          label: "1/2 완료",
          tasks: [{ id: "t0", title: "질문A", status: "done" }],
        });
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "ok" },
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
      tools: [progTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    const progress = result.find((e) => e.type === "tool_progress");
    expect(progress).toMatchObject({
      type: "tool_progress",
      toolCallId: "call-1",
      stage: "researching",
      label: "1/2 완료",
    });
    const progressIdx = result.findIndex((e) => e.type === "tool_progress");
    const resultIdx = result.findIndex((e) => e.type === "tool_result");
    expect(progressIdx).toBeGreaterThanOrEqual(0);
    expect(progressIdx).toBeLessThan(resultIdx);
  });

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

describe("orchestrator.runTurn — artifact-create artifact_created emit (P10-T2-04)", () => {
  it("생성 툴이 artifact 를 담은 json 결과를 반환하면 tool_result 뒤에 artifact_created 이벤트를 emit 한다", async () => {
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
            name: "artifact_create",
            args: { filename: "notes.md", type: "markdown", content: "# hi" },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { type: "text_delta", text: "생성 완료" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };
    const artifactCreateTool: AgentTool = {
      spec: {
        name: "artifact_create",
        description: "아티팩트 생성",
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
              artifact: {
                artifactId: "artifact-1",
                artifactKind: "markdown",
                filename: "notes.md",
                sizeBytes: 4,
                downloadUrl: "/api/v1/artifacts/artifact-1/content",
              },
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
      messages: [{ role: "user", content: "메모 만들어줘" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [artifactCreateTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(result.map((e) => e.type)).toEqual([
      "tool_use",
      "stop",
      "tool_result",
      "artifact_created",
      "text_delta",
      "stop",
    ]);
    const artifactEvent = result.find((e) => e.type === "artifact_created");
    expect(artifactEvent).toMatchObject({
      type: "artifact_created",
      artifactId: "artifact-1",
      artifactKind: "markdown",
      filename: "notes.md",
      sizeBytes: 4,
      downloadUrl: "/api/v1/artifacts/artifact-1/content",
    });
  });

  it("tool json 결과에 artifact 필드가 없으면 artifact_created 이벤트를 emit 하지 않는다", async () => {
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

describe("orchestrator.runTurn — 병렬 tool 실행 (P11-T2-09)", () => {
  it("독립 allow 툴 2개는 Promise.all 로 동시에 invoke 되고, tool_result 는 완료 순서와 무관하게 원래 tool_use 순서를 보존한다", async () => {
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
            name: "slow_tool",
            args: {},
          };
          yield {
            type: "tool_use",
            toolCallId: "call-2",
            name: "fast_tool",
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

    const order: string[] = [];
    const slowTool: AgentTool = {
      spec: {
        name: "slow_tool",
        description: "느린 독립 툴",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        order.push("start:slow");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("end:slow");
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "slow-done" },
        };
      },
    };
    const fastTool: AgentTool = {
      spec: {
        name: "fast_tool",
        description: "빠른 독립 툴",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        order.push("start:fast");
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "fast-done" },
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
      tools: [slowTool, fastTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    // slow_tool 이 아직 끝나기 전에 fast_tool 이 이미 시작됐어야 동시 invoke 증거.
    expect(order).toEqual(["start:slow", "start:fast", "end:slow"]);
    const toolResultEvents = result.filter(
      (e): e is Extract<ChatEvent, { type: "tool_result" }> =>
        e.type === "tool_result",
    );
    expect(toolResultEvents.map((e) => e.toolCallId)).toEqual([
      "call-1",
      "call-2",
    ]);
  });

  it("hitl 정책 툴은 allow 병렬 배치와 분리되어 직렬로 승인되며(승인 순서 보존), tool_result 순서도 원래 tool_use 순서를 유지한다", async () => {
    const calls: ChatInput[] = [];
    const askApprovalOrder: string[] = [];
    let resolveFirstApproval: (() => void) | undefined;
    const firstApprovalGate = new Promise<void>((resolve) => {
      resolveFirstApproval = resolve;
    });
    const hitl: HitlBridge = {
      async askApproval(input) {
        askApprovalOrder.push(`start:${input.toolCallId}`);
        if (input.toolCallId === "call-1") {
          await firstApprovalGate;
        }
        askApprovalOrder.push(`resolved:${input.toolCallId}`);
        return { kind: "approved" };
      },
    };

    const invoked: string[] = [];
    const gatedTool2: AgentTool = {
      spec: {
        name: "gated_tool_2",
        description: "두번째 승인 필요 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "hitl",
      },
      async invoke(input) {
        invoked.push(input.toolCallId);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "gated-2-output" },
        };
      },
    };
    const invokedFirst: unknown[] = [];
    const gatedTool: AgentTool = {
      spec: {
        name: "gated_tool",
        description: "부수효과 있는 위험 툴",
        inputSchema: { type: "object" },
        permissionTier: "user",
        defaultPolicy: "hitl",
      },
      async invoke(input) {
        invokedFirst.push(input.args);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "gated-output" },
        };
      },
    };

    const twoToolProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        if (calls.length === 1) {
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "gated_tool",
            args: { x: 1 },
          };
          yield {
            type: "tool_use",
            toolCallId: "call-2",
            name: "gated_tool_2",
            args: { y: 1 },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { type: "text_delta", text: "후속" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };

    const runPromise = (async () => {
      const result: ChatEvent[] = [];
      for await (const event of runTurn({
        provider: twoToolProvider,
        model: "fake-model",
        systemBlocks: [],
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 512,
        signal: new AbortController().signal,
        tools: [gatedTool, gatedTool2],
        toolContext: fakeToolContext(hitl),
      })) {
        result.push(event);
      }
      return result;
    })();

    // call-2 의 승인 요청이 call-1 승인 완료 전에 시작되면(동시 프롬프트) 직렬성 위반.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(askApprovalOrder).toEqual(["start:call-1"]);
    resolveFirstApproval!();

    const result = await runPromise;

    expect(askApprovalOrder).toEqual([
      "start:call-1",
      "resolved:call-1",
      "start:call-2",
      "resolved:call-2",
    ]);
    expect(invokedFirst).toEqual([{ x: 1 }]);
    expect(invoked).toEqual(["call-2"]);
    const toolResultEvents = result.filter(
      (e): e is Extract<ChatEvent, { type: "tool_result" }> =>
        e.type === "tool_result",
    );
    expect(toolResultEvents.map((e) => e.toolCallId)).toEqual([
      "call-1",
      "call-2",
    ]);
  });

  it("tools 가 등록되면 provider.chat 의 ChatInput.parallelToolCalls 로 RunTurnInput.parallelToolCalls 를 그대로 forward 한다", async () => {
    const calls: ChatInput[] = [];
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        yield { type: "text_delta", text: "ok" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const noopTool: AgentTool = {
      spec: {
        name: "noop_tool",
        description: "미사용 툴(스펙 forward 확인용)",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "unused" },
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
      tools: [noopTool],
      toolContext: fakeToolContext(),
      parallelToolCalls: true,
    })) {
      result.push(event);
    }

    expect(calls[0]?.parallelToolCalls).toBe(true);
  });
});

describe("orchestrator.runTurn — arg-validator invoke 직전 검증 (P11-T2-10)", () => {
  it("필수 필드가 누락된 args 는 allow 툴의 invoke 를 트리거하지 않고 SCHEMA_INVALID tool_result(error) 를 emit 한다", async () => {
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
            name: "strict_tool",
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
    const invoked: unknown[] = [];
    const strictTool: AgentTool = {
      spec: {
        name: "strict_tool",
        description: "필수 인자 있는 툴",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        invoked.push(input.args);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "should-not-run" },
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
      tools: [strictTool],
      toolContext: fakeToolContext(),
    })) {
      result.push(event);
    }

    expect(invoked).toEqual([]);
    const toolResultEvent = result.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      toolCallId: "call-1",
      content: {
        error: expect.objectContaining({ code: "SCHEMA_INVALID" }),
      },
    });
  });

  it("hitl 정책 툴도 승인 후 args 가 스키마와 불일치하면 invoke 를 트리거하지 않고 SCHEMA_INVALID tool_result(error) 를 emit 한다", async () => {
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
            name: "gated_strict_tool",
            args: { x: "not-a-number" },
          };
          yield {
            type: "stop",
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield { type: "text_delta", text: "후속" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 2, outputTokens: 2 },
        };
      },
    };
    const invoked: unknown[] = [];
    const gatedStrictTool: AgentTool = {
      spec: {
        name: "gated_strict_tool",
        description: "승인 필요 + 스키마 있는 툴",
        inputSchema: {
          type: "object",
          properties: { x: { type: "number" } },
          required: ["x"],
        },
        permissionTier: "user",
        defaultPolicy: "hitl",
      },
      async invoke(input) {
        invoked.push(input.args);
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "should-not-run" },
        };
      },
    };
    const hitl: HitlBridge = {
      async askApproval() {
        return { kind: "approved" };
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
      tools: [gatedStrictTool],
      toolContext: fakeToolContext(hitl),
    })) {
      result.push(event);
    }

    expect(invoked).toEqual([]);
    const toolResultEvent = result.find((e) => e.type === "tool_result");
    expect(toolResultEvent).toMatchObject({
      toolCallId: "call-1",
      content: {
        error: expect.objectContaining({ code: "SCHEMA_INVALID" }),
      },
    });
  });
});

function fakeToolContextWithLoggerSpy(): {
  toolContext: ToolContext;
  logCalls: Array<{ level: string; payload: LogPayload }>;
} {
  const logCalls: Array<{ level: string; payload: LogPayload }> = [];
  const logger: Logger = {
    debug(p) {
      logCalls.push({ level: "debug", payload: p });
    },
    info(p) {
      logCalls.push({ level: "info", payload: p });
    },
    warn(p) {
      logCalls.push({ level: "warn", payload: p });
    },
    error(p) {
      logCalls.push({ level: "error", payload: p });
    },
    fatal(p) {
      logCalls.push({ level: "fatal", payload: p });
    },
    child() {
      return logger;
    },
  };
  return {
    toolContext: {
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
    },
    logCalls,
  };
}

function fakeToolMetricRepo(): {
  appended: ToolMetricEntry[];
  append(entry: ToolMetricEntry): Promise<void>;
} {
  const appended: ToolMetricEntry[] = [];
  return {
    appended,
    async append(entry) {
      appended.push(entry);
    },
  };
}

describe("orchestrator.runTurn — 툴 관측: tool-metrics + gen_ai.* span (P11-T2-13)", () => {
  it("allow 정책 툴 invoke 성공 시 tool-metrics 에 status=ok 로 기록되고 gen_ai.* span 로그(결과 본문 포함)가 생성된다", async () => {
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
            name: "metered_tool",
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
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const meteredTool: AgentTool = {
      spec: {
        name: "metered_tool",
        description: "계측 대상 allow 툴",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "ok-result" },
        };
      },
    };

    const { toolContext, logCalls } = fakeToolContextWithLoggerSpy();
    const toolMetrics = fakeToolMetricRepo();

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [meteredTool],
      toolContext,
      toolMetrics,
    })) {
      result.push(event);
    }

    expect(result.some((e) => e.type === "tool_result")).toBe(true);
    expect(toolMetrics.appended).toHaveLength(1);
    expect(toolMetrics.appended[0]).toMatchObject({
      toolName: "metered_tool",
      status: "ok",
      userId: "user-1",
      orgId: "org-1",
    });
    expect(toolMetrics.appended[0]?.durationMs).toBeGreaterThanOrEqual(0);

    const spanEnd = logCalls.find((c) => {
      const context = c.payload.context as Record<string, unknown> | undefined;
      return (
        c.level === "info" && context?.["gen_ai.tool.name"] === "metered_tool"
      );
    });
    expect(spanEnd).toBeDefined();
    expect(spanEnd?.payload.context).toMatchObject({
      "gen_ai.tool.name": "metered_tool",
      "gen_ai.tool.call.id": "call-1",
      "gen_ai.tool.call.policy": "allow",
      "gen_ai.tool.call.result": { kind: "text", text: "ok-result" },
    });
  });

  it("invoke 결과가 error content 이면 tool-metrics 에 status=error 로 기록한다", async () => {
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
            name: "failing_tool",
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
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const failingTool: AgentTool = {
      spec: {
        name: "failing_tool",
        description: "항상 실패하는 allow 툴",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: {
            kind: "error",
            error: new (await import("@wchat/interfaces")).WChatError(
              "UPSTREAM_ERROR",
              "tool",
              true,
              "실패",
            ),
          },
        };
      },
    };

    const { toolContext } = fakeToolContextWithLoggerSpy();
    const toolMetrics = fakeToolMetricRepo();

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [failingTool],
      toolContext,
      toolMetrics,
    })) {
      result.push(event);
    }

    expect(toolMetrics.appended).toHaveLength(1);
    expect(toolMetrics.appended[0]).toMatchObject({
      toolName: "failing_tool",
      status: "error",
    });
  });

  it("toolMetrics 미주입 시에도 invoke 는 정상 동작한다(옵션 필드)", async () => {
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
            name: "metered_tool",
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
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const meteredTool: AgentTool = {
      spec: {
        name: "metered_tool",
        description: "계측 대상 allow 툴",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke(input) {
        return {
          toolCallId: input.toolCallId,
          content: { kind: "text", text: "ok-result" },
        };
      },
    };

    const { toolContext } = fakeToolContextWithLoggerSpy();

    const result: ChatEvent[] = [];
    for await (const event of runTurn({
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [meteredTool],
      toolContext,
    })) {
      result.push(event);
    }

    expect(result.some((e) => e.type === "tool_result")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ChatInput,
  HitlBridge,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { createWorkerTool } from "../orchestrator-worker.js";

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

describe("orchestrator-worker.createWorkerTool — Orchestrator-Worker 조합", () => {
  it("worker 는 부모 대화 이력과 무관하게 격리된 messages(task 하나)와 스코프 tools 만 내부 runTurn 에 전달한다", async () => {
    let receivedInput: ChatInput | undefined;
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        receivedInput = input;
        yield {
          type: "message_start",
          messageId: "msg-1",
          meta: { provider: "fake", model: "fake-model" },
        };
        yield { type: "text_delta", text: "worker 결과" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const scopedTool: AgentTool = {
      spec: {
        name: "scoped_only",
        description: "worker 전용 스코프 tool",
        inputSchema: { type: "object", properties: {} },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke({ toolCallId }) {
        return { toolCallId, content: { kind: "text", text: "unused" } };
      },
    };

    const worker = createWorkerTool({
      name: "research_worker",
      description: "격리된 리서치 서브에이전트",
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [{ tier: "system", content: "worker 시스템 규칙" }],
      maxTokens: 512,
      tools: [scopedTool],
    });

    const result = await worker.invoke({
      toolCallId: "call-1",
      args: { task: "이 서브태스크를 조사해줘" },
      ctx: fakeToolContext(),
    });

    expect(receivedInput?.messages).toEqual([
      { role: "user", content: "이 서브태스크를 조사해줘" },
    ]);
    expect(receivedInput?.tools).toEqual([scopedTool.spec]);
    expect(result.content).toEqual({ kind: "text", text: "worker 결과" });
  });

  it("worker 내부의 tool_use/tool_result 는 부모에게 노출되지 않고, 압축된 최종 텍스트만 tool_result 로 반환된다", async () => {
    const scopedTool: AgentTool = {
      spec: {
        name: "scoped_tool",
        description: "worker 스코프 tool",
        inputSchema: { type: "object", properties: {} },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke({ toolCallId }) {
        return {
          toolCallId,
          content: { kind: "text", text: "스코프 tool 결과" },
        };
      },
    };
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        const lastMessage = input.messages.at(-1);
        if (lastMessage?.role === "tool") {
          yield {
            type: "message_start",
            messageId: "msg-2",
            meta: { provider: "fake", model: "fake-model" },
          };
          yield { type: "text_delta", text: "압축된 최종 요약" };
          yield {
            type: "stop",
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield {
          type: "message_start",
          messageId: "msg-1",
          meta: { provider: "fake", model: "fake-model" },
        };
        yield {
          type: "tool_use",
          toolCallId: "inner-1",
          name: "scoped_tool",
          args: {},
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 0 },
        };
      },
    };

    const worker = createWorkerTool({
      name: "research_worker",
      description: "격리된 리서치 서브에이전트",
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      maxTokens: 512,
      tools: [scopedTool],
    });

    const result = await worker.invoke({
      toolCallId: "call-2",
      args: { task: "스코프 tool 을 써서 조사해줘" },
      ctx: fakeToolContext(),
    });

    expect(result.content).toEqual({
      kind: "text",
      text: "압축된 최종 요약",
    });
  });

  it("task 인자가 없으면 invoke 를 트리거하지 않고 INVALID_INPUT 에러를 반환한다", async () => {
    let chatCalled = false;
    const fakeProvider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        chatCalled = true;
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };

    const worker = createWorkerTool({
      name: "research_worker",
      description: "격리된 리서치 서브에이전트",
      provider: fakeProvider,
      model: "fake-model",
      systemBlocks: [],
      maxTokens: 512,
    });

    const result = await worker.invoke({
      toolCallId: "call-3",
      args: {},
      ctx: fakeToolContext(),
    });

    expect(chatCalled).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });
});

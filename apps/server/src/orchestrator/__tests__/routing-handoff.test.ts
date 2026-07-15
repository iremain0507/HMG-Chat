import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  HitlBridge,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { createRoutingHandoffTool } from "../routing-handoff.js";
import type { HandoffPayload } from "../routing-handoff.js";

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
  const hitl: HitlBridge = {
    async askApproval() {
      return { kind: "approved" };
    },
  };
  return {
    requestId: "req-1",
    userId: "user-1",
    orgId: "org-1",
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger,
    hitl,
    budget: {
      async claim() {},
      async settle() {},
      async refund() {},
      remaining: Infinity,
    },
  };
}

function specialistWorker(label: string): {
  tool: AgentTool;
  calls: Array<{ task: unknown }>;
} {
  const calls: Array<{ task: unknown }> = [];
  const tool: AgentTool = {
    spec: {
      name: `${label}_worker`,
      description: `${label} 전담 worker`,
      inputSchema: { type: "object", properties: { task: { type: "string" } } },
      permissionTier: "tool",
      defaultPolicy: "allow",
    },
    async invoke({ toolCallId, args }) {
      calls.push({ task: args.task });
      return {
        toolCallId,
        content: { kind: "text", text: `${label}:${String(args.task)}` },
      };
    },
  };
  return { tool, calls };
}

function classifierProvider(
  answer: string | ((task: string) => string),
): LLMProvider {
  return {
    name: "fake-classifier",
    models: ["fake-classifier-model"],
    async *chat(input) {
      const last = input.messages.at(-1);
      const task = last?.role === "user" ? String(last.content) : "";
      const text = typeof answer === "function" ? answer(task) : answer;
      yield {
        type: "message_start",
        messageId: "msg-1",
        meta: { provider: "fake-classifier", model: "fake-classifier-model" },
      };
      yield { type: "text_delta", text };
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("routing-handoff.createRoutingHandoffTool — Routing/Handoff 노드", () => {
  it("분류 결과(knowledge)에 해당하는 specialist worker 로만 위임하고, handoff payload 를 내부 훅으로만 노출한다", async () => {
    const knowledge = specialistWorker("knowledge");
    const artifact = specialistWorker("artifact");
    const general = specialistWorker("general");
    const payloads: HandoffPayload[] = [];

    const router = createRoutingHandoffTool({
      name: "route_request",
      description: "요청을 분류해 specialist worker 에 위임",
      provider: classifierProvider("knowledge"),
      model: "fake-classifier-model",
      maxTokens: 32,
      specialists: {
        knowledge: knowledge.tool,
        artifact: artifact.tool,
        general: general.tool,
      },
      fallback: "general",
      onHandoff: (payload) => payloads.push(payload),
    });

    const result = await router.invoke({
      toolCallId: "call-1",
      args: { task: "RAG citation 이 어떻게 동작하나요?" },
      ctx: fakeToolContext(),
    });

    expect(knowledge.calls).toEqual([
      { task: "RAG citation 이 어떻게 동작하나요?" },
    ]);
    expect(artifact.calls).toEqual([]);
    expect(general.calls).toEqual([]);
    expect(result.content).toEqual({
      kind: "text",
      text: "knowledge:RAG citation 이 어떻게 동작하나요?",
    });
    expect(payloads).toEqual([
      {
        classification: "knowledge",
        targetWorker: "knowledge",
        task: "RAG citation 이 어떻게 동작하나요?",
      },
    ]);
  });

  it("분류기 응답이 알려진 카테고리와 일치하지 않으면 fallback specialist 로 위임한다", async () => {
    const knowledge = specialistWorker("knowledge");
    const general = specialistWorker("general");
    const payloads: HandoffPayload[] = [];

    const router = createRoutingHandoffTool({
      name: "route_request",
      description: "요청을 분류해 specialist worker 에 위임",
      provider: classifierProvider("이건 분류 불가능한 응답입니다"),
      model: "fake-classifier-model",
      maxTokens: 32,
      specialists: { knowledge: knowledge.tool, general: general.tool },
      fallback: "general",
      onHandoff: (payload) => payloads.push(payload),
    });

    const result = await router.invoke({
      toolCallId: "call-2",
      args: { task: "아무 요청" },
      ctx: fakeToolContext(),
    });

    expect(knowledge.calls).toEqual([]);
    expect(general.calls).toEqual([{ task: "아무 요청" }]);
    expect(result.content).toEqual({ kind: "text", text: "general:아무 요청" });
    expect(payloads).toEqual([
      { classification: "general", targetWorker: "general", task: "아무 요청" },
    ]);
  });

  it("task 인자가 없으면 분류기를 호출하지 않고 INVALID_INPUT 에러를 반환한다", async () => {
    let chatCalled = false;
    const provider: LLMProvider = {
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
    const general = specialistWorker("general");

    const router = createRoutingHandoffTool({
      name: "route_request",
      description: "요청을 분류해 specialist worker 에 위임",
      provider,
      model: "fake-model",
      maxTokens: 32,
      specialists: { general: general.tool },
      fallback: "general",
    });

    const result = await router.invoke({
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

  it("specialists 에 fallback 키가 없으면 생성 시점에 즉시 에러를 던진다(설정 오류)", () => {
    const knowledge = specialistWorker("knowledge");
    expect(() =>
      createRoutingHandoffTool({
        name: "route_request",
        description: "요청을 분류해 specialist worker 에 위임",
        provider: classifierProvider("knowledge"),
        model: "fake-classifier-model",
        maxTokens: 32,
        specialists: { knowledge: knowledge.tool },
        fallback: "general",
      }),
    ).toThrow(/fallback/i);
  });
});

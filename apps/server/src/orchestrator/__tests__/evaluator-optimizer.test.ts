import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  HitlBridge,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { createEvaluatorOptimizerTool } from "../evaluator-optimizer.js";

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

function fakeGenerator(produce: (task: string, callIndex: number) => string): {
  tool: AgentTool;
  calls: Array<{ task: unknown }>;
} {
  const calls: Array<{ task: unknown }> = [];
  const tool: AgentTool = {
    spec: {
      name: "artifact_generator",
      description: "artifact 생성 worker",
      inputSchema: {
        type: "object",
        properties: { task: { type: "string" } },
      },
      permissionTier: "tool",
      defaultPolicy: "allow",
    },
    async invoke({ toolCallId, args }) {
      calls.push({ task: args.task });
      const text = produce(String(args.task), calls.length);
      return { toolCallId, content: { kind: "text", text } };
    },
  };
  return { tool, calls };
}

function evaluatorProvider(
  verdictFor: (content: string) => { pass: boolean; feedback: string },
): LLMProvider {
  return {
    name: "fake-evaluator",
    models: ["fake-evaluator-model"],
    async *chat(input) {
      const last = input.messages.at(-1);
      const content = last?.role === "user" ? String(last.content) : "";
      const { pass, feedback } = verdictFor(content);
      yield {
        type: "message_start",
        messageId: "msg-eval",
        meta: { provider: "fake-evaluator", model: "fake-evaluator-model" },
      };
      yield {
        type: "text_delta",
        text: `${pass ? "PASS" : "FAIL"}\n${feedback}`,
      };
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("evaluator-optimizer.createEvaluatorOptimizerTool — Evaluator-Optimizer 래퍼", () => {
  it("평가 PASS 면 1회 생성만으로 즉시 반환하고 재생성하지 않는다", async () => {
    const generator = fakeGenerator(() => "완성된 초안");
    const evaluator = evaluatorProvider(() => ({ pass: true, feedback: "" }));

    const tool = createEvaluatorOptimizerTool({
      name: "artifact_evaluator_optimizer",
      description: "생성+평가 닫힌 루프",
      generator: generator.tool,
      evaluatorProvider: evaluator,
      evaluatorModel: "fake-evaluator-model",
      maxTokens: 256,
      criteria: "문서에 제목과 결론이 모두 포함되어야 한다",
    });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { task: "보고서를 작성해줘" },
      ctx: fakeToolContext(),
    });

    expect(generator.calls).toHaveLength(1);
    expect(result.content).toEqual({ kind: "text", text: "완성된 초안" });
  });

  it("평가 FAIL 시 피드백을 반영해 재생성하고, 다음 평가가 PASS 면 개선된 결과를 반환한다", async () => {
    const generator = fakeGenerator((task, callIndex) =>
      callIndex === 1 ? "초안(제목 없음)" : `개선된 초안 (task=${task})`,
    );
    const evaluator = evaluatorProvider((content) => ({
      pass: content.includes("개선된 초안"),
      feedback: "제목을 추가하라",
    }));

    const tool = createEvaluatorOptimizerTool({
      name: "artifact_evaluator_optimizer",
      description: "생성+평가 닫힌 루프",
      generator: generator.tool,
      evaluatorProvider: evaluator,
      evaluatorModel: "fake-evaluator-model",
      maxTokens: 256,
      criteria: "문서에 제목과 결론이 모두 포함되어야 한다",
    });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { task: "보고서를 작성해줘" },
      ctx: fakeToolContext(),
    });

    expect(generator.calls).toHaveLength(2);
    expect(String(generator.calls[1]?.task)).toContain("제목을 추가하라");
    expect(result.content).toEqual({
      kind: "text",
      text: expect.stringContaining("개선된 초안"),
    });
  });

  it("maxIterations 를 넘도록 계속 FAIL 이어도 무한루프 없이 마지막 생성 결과를 반환한다(MAST 종료조건)", async () => {
    const generator = fakeGenerator((_task, callIndex) => `시도-${callIndex}`);
    const evaluator = evaluatorProvider(() => ({
      pass: false,
      feedback: "여전히 미달",
    }));

    const tool = createEvaluatorOptimizerTool({
      name: "artifact_evaluator_optimizer",
      description: "생성+평가 닫힌 루프",
      generator: generator.tool,
      evaluatorProvider: evaluator,
      evaluatorModel: "fake-evaluator-model",
      maxTokens: 256,
      criteria: "절대 만족할 수 없는 기준",
      maxIterations: 2,
    });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { task: "보고서를 작성해줘" },
      ctx: fakeToolContext(),
    });

    expect(generator.calls).toHaveLength(2);
    expect(result.content).toEqual({ kind: "text", text: "시도-2" });
  });

  it("task 인자가 없으면 generator/evaluator 를 호출하지 않고 INVALID_INPUT 에러를 반환한다", async () => {
    let generatorCalled = false;
    let evaluatorCalled = false;
    const generator: AgentTool = {
      spec: {
        name: "artifact_generator",
        description: "artifact 생성 worker",
        inputSchema: { type: "object", properties: {} },
        permissionTier: "tool",
        defaultPolicy: "allow",
      },
      async invoke({ toolCallId }) {
        generatorCalled = true;
        return { toolCallId, content: { kind: "text", text: "unused" } };
      },
    };
    const evaluator: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        evaluatorCalled = true;
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    };

    const tool = createEvaluatorOptimizerTool({
      name: "artifact_evaluator_optimizer",
      description: "생성+평가 닫힌 루프",
      generator,
      evaluatorProvider: evaluator,
      evaluatorModel: "fake-model",
      maxTokens: 256,
      criteria: "명확한 기준",
    });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: {},
      ctx: fakeToolContext(),
    });

    expect(generatorCalled).toBe(false);
    expect(evaluatorCalled).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("criteria 가 비어있으면 생성 시점에 즉시 에러를 던진다(명확한 기준일 때만 반복 개선)", () => {
    const generator = fakeGenerator(() => "초안");
    const evaluator = evaluatorProvider(() => ({ pass: true, feedback: "" }));

    expect(() =>
      createEvaluatorOptimizerTool({
        name: "artifact_evaluator_optimizer",
        description: "생성+평가 닫힌 루프",
        generator: generator.tool,
        evaluatorProvider: evaluator,
        evaluatorModel: "fake-evaluator-model",
        maxTokens: 256,
        criteria: "   ",
      }),
    ).toThrow(/criteria/i);
  });
});

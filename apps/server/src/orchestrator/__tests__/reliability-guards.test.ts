import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ChatInput,
  HitlBridge,
  LLMProvider,
  ToolContext,
} from "@wchat/interfaces";
import { runTurn } from "../orchestrator.js";
import {
  detectStepRepetition,
  checkReasoningActionConsistency,
  toolCallSignature,
} from "../reliability-guards.js";
import { verifyBeforeSynthesis } from "../verification-worker.js";

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

function fakeTool(): { tool: AgentTool; invokeCount: () => number } {
  let count = 0;
  const tool: AgentTool = {
    spec: {
      name: "loop_tool",
      description: "반복 호출용 테스트 툴",
      inputSchema: { type: "object" },
      permissionTier: "user",
      defaultPolicy: "allow",
    },
    async invoke(input) {
      count += 1;
      return {
        toolCallId: input.toolCallId,
        content: { kind: "text", text: "ok" },
      };
    },
  };
  return { tool, invokeCount: () => count };
}

describe("reliability-guards — 순수 함수", () => {
  it("toolCallSignature 는 name+args 로 안정적인 시그니처를 만든다", () => {
    expect(toolCallSignature("t", { a: 1 })).toBe(
      toolCallSignature("t", { a: 1 }),
    );
    expect(toolCallSignature("t", { a: 1 })).not.toBe(
      toolCallSignature("t", { a: 2 }),
    );
  });

  it("detectStepRepetition 은 직전 라운드와 완전히 동일한 tool_use 세트일 때만 true", () => {
    const round = [toolCallSignature("t", { a: 1 })];
    expect(detectStepRepetition(round, round)).toBe(true);
    expect(detectStepRepetition([], round)).toBe(false);
    expect(
      detectStepRepetition(round, [toolCallSignature("t", { a: 2 })]),
    ).toBe(false);
  });

  it("checkReasoningActionConsistency 는 tool_use 직전 추론 텍스트가 공백뿐이면 false", () => {
    expect(checkReasoningActionConsistency("이유가 있다", 1)).toBe(true);
    expect(checkReasoningActionConsistency("   ", 1)).toBe(false);
    expect(checkReasoningActionConsistency("", 0)).toBe(true);
  });
});

describe("reliability-guards — runTurn 스텝반복 차단 (MAST 17.1%)", () => {
  it("동일 tool_use 가 threshold 회 연속 반복되면 invoke 없이 error 로 중단한다", async () => {
    const { tool, invokeCount } = fakeTool();
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        yield {
          type: "tool_use",
          toolCallId: "call-x",
          name: "loop_tool",
          args: { same: true },
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const events = [];
    for await (const event of runTurn({
      provider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "loop" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [tool],
      toolContext: fakeToolContext(),
      reliabilityGuards: { stepRepetitionThreshold: 3 },
    })) {
      events.push(event);
    }

    // 3라운드 연속 동일 tool_use → 3번째 라운드는 invoke 되지 않고 차단되어야 한다.
    expect(invokeCount()).toBeLessThan(3);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error: { code: string } }).error.code).toBe(
      "STEP_REPETITION_DETECTED",
    );
  });

  it("reliabilityGuards 미설정 시 기존 동작과 동일 — 반복해도 차단하지 않는다", async () => {
    const { tool, invokeCount } = fakeTool();
    let round = 0;
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        round += 1;
        if (round <= 4) {
          yield {
            type: "tool_use",
            toolCallId: `call-${round}`,
            name: "loop_tool",
            args: { same: true },
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

    for await (const event of runTurn({
      provider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "loop" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [tool],
      toolContext: fakeToolContext(),
    })) {
      void event; // drain — no reliabilityGuards passed
    }

    expect(invokeCount()).toBe(4);
  });
});

describe("reliability-guards — runTurn 명시적 종료조건 (MAST 9.8%)", () => {
  it("maxSteps 를 초과하면 error 로 중단한다(무한루프 방지)", async () => {
    const { tool } = fakeTool();
    let round = 0;
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        round += 1;
        yield {
          type: "tool_use",
          toolCallId: `call-${round}`,
          name: "loop_tool",
          args: { round },
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const events = [];
    for await (const event of runTurn({
      provider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "loop" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [tool],
      toolContext: fakeToolContext(),
      reliabilityGuards: { maxSteps: 2, stepRepetitionThreshold: 999 },
    })) {
      events.push(event);
    }

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error: { code: string } }).error.code).toBe(
      "MAX_STEPS_EXCEEDED",
    );
    expect(round).toBeLessThanOrEqual(3);
  });
});

describe("reliability-guards — runTurn 추론-행동 일치 체크 (MAST 14%)", () => {
  it("checkReasoningActionConsistency:true 일 때 추론 텍스트 없이 바로 tool_use 하면 error 로 중단한다", async () => {
    const { tool, invokeCount } = fakeTool();
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        // text_delta 없이 곧바로 tool_use — "왜" 호출하는지 근거가 없다.
        yield {
          type: "tool_use",
          toolCallId: "call-1",
          name: "loop_tool",
          args: {},
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const events = [];
    for await (const event of runTurn({
      provider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [tool],
      toolContext: fakeToolContext(),
      reliabilityGuards: { checkReasoningActionConsistency: true },
    })) {
      events.push(event);
    }

    expect(invokeCount()).toBe(0);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { error: { code: string } }).error.code).toBe(
      "REASONING_ACTION_MISMATCH",
    );
  });

  it("추론 텍스트를 동반한 tool_use 는 통과한다", async () => {
    const { tool, invokeCount } = fakeTool();
    let round = 0;
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        round += 1;
        if (round === 1) {
          yield {
            type: "text_delta",
            text: "이 정보를 찾기 위해 툴을 호출한다",
          };
          yield {
            type: "tool_use",
            toolCallId: "call-1",
            name: "loop_tool",
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

    for await (const event of runTurn({
      provider,
      model: "fake-model",
      systemBlocks: [],
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 512,
      signal: new AbortController().signal,
      tools: [tool],
      toolContext: fakeToolContext(),
      reliabilityGuards: { checkReasoningActionConsistency: true },
    })) {
      void event; // drain
    }

    expect(invokeCount()).toBe(1);
  });
});

describe("verification-worker.verifyBeforeSynthesis — 검증 worker (MAST 검증부재 21.3%)", () => {
  function verdictProvider(verdictText: string): LLMProvider {
    const calls: ChatInput[] = [];
    return {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        calls.push(input);
        yield { type: "text_delta", text: verdictText };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
  }

  it("종합 결과가 작업을 완수하지 못했다고 판단되면 verified:false 를 반환한다", async () => {
    const provider = verdictProvider("REJECTED\n원 질문에 답하지 않았다");
    const verdict = await verifyBeforeSynthesis(
      "질문: 오늘 날씨는?",
      "무관한 답변",
      { provider, model: "fake-model", maxTokens: 256 },
      new AbortController().signal,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.feedback).toContain("원 질문");
  });

  it("종합 결과가 작업을 완수했다고 판단되면 verified:true 를 반환한다", async () => {
    const provider = verdictProvider("VERIFIED\n질문에 정확히 답했다");
    const verdict = await verifyBeforeSynthesis(
      "질문: 오늘 날씨는?",
      "맑음",
      { provider, model: "fake-model", maxTokens: 256 },
      new AbortController().signal,
    );
    expect(verdict.verified).toBe(true);
  });
});

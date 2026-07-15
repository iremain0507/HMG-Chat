// abort-fanout.test.ts — P12-T2-03: 부모 AbortSignal 취소 시 진행중인 병렬 worker/DAG 노드가
// provider 자체의 signal 관찰 여부와 무관하게 즉시 중단되는지 검증한다(20-MULTI-AGENT-TOOL.md
// §20.4-5 "AbortSignal 을 모든 worker/tool 에 fan-out"). fake provider 는 signal 을 전혀 감시하지
// 않는(비협조적) 실제 네트워크 유사 상황을 시뮬레이션 — provider 가 끝나길 기다리면 영원히 멈춘다.
import { describe, it, expect } from "vitest";
import type { HitlBridge, LLMProvider, ToolContext } from "@wchat/interfaces";
import { runDag } from "../dag-planner.js";
import { createWorkerTool } from "../orchestrator-worker.js";

function fakeToolContext(signal: AbortSignal): ToolContext {
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
    signal,
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

// signal 을 전혀 확인하지 않는 provider — 실 네트워크 요청이 응답 없이 멈춘 상황과 동등.
function hangingProvider(onStart: () => void): LLMProvider {
  return {
    name: "hanging",
    models: ["hang-model"],
    async *chat() {
      onStart();
      await new Promise<void>(() => {});
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

const SETTLE_TIMEOUT_MS = 200;

async function settlesWithin(
  promise: Promise<unknown>,
  ms: number,
): Promise<"resolved" | "rejected"> {
  const outcome = await Promise.race([
    promise.then(
      () => "resolved" as const,
      () => "rejected" as const,
    ),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${ms}ms 내에 중단되지 않음`)), ms);
    }),
  ]);
  return outcome;
}

describe("AbortSignal fan-out — 부모 취소 시 진행중 병렬 실행 즉시 중단", () => {
  it("dag-planner: 같은 레벨의 독립 노드가 실행 중일 때 부모가 취소하면 즉시 중단된다", async () => {
    const controller = new AbortController();
    let startedCount = 0;
    const provider = hangingProvider(() => {
      startedCount += 1;
    });

    const runPromise = runDag(
      {
        nodes: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      },
      {
        provider,
        model: "hang-model",
        systemBlocks: [],
        maxTokens: 512,
        ctx: fakeToolContext(controller.signal),
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedCount).toBe(2);

    controller.abort();

    await expect(settlesWithin(runPromise, SETTLE_TIMEOUT_MS)).resolves.toBe(
      "rejected",
    );
  });

  it("orchestrator-worker: 병렬로 호출된 여러 worker 가 부모 취소 시 전부 즉시 중단된다", async () => {
    const controller = new AbortController();
    let startedCount = 0;
    const provider = hangingProvider(() => {
      startedCount += 1;
    });

    const worker = createWorkerTool({
      name: "research_worker",
      description: "격리된 리서치 서브에이전트",
      provider,
      model: "hang-model",
      systemBlocks: [],
      maxTokens: 512,
    });

    const ctx = fakeToolContext(controller.signal);
    const invocations = [
      worker.invoke({ toolCallId: "call-1", args: { task: "a" }, ctx }),
      worker.invoke({ toolCallId: "call-2", args: { task: "b" }, ctx }),
    ];

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(startedCount).toBe(2);

    controller.abort();

    await expect(
      settlesWithin(Promise.all(invocations), SETTLE_TIMEOUT_MS),
    ).resolves.toBe("rejected");
  });
});

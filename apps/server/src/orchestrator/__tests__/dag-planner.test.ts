import { describe, it, expect } from "vitest";
import type { HitlBridge, LLMProvider, ToolContext } from "@wchat/interfaces";
import { runDag } from "../dag-planner.js";

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

// task 문자열의 마지막 user 메시지를 그대로 되돌려주는 fake provider.
function echoProvider(): LLMProvider {
  return {
    name: "fake",
    models: ["fake-model"],
    async *chat(input) {
      const last = input.messages.at(-1);
      const text = last?.role === "user" ? String(last.content) : "";
      yield {
        type: "message_start",
        messageId: "msg-1",
        meta: { provider: "fake", model: "fake-model" },
      };
      yield { type: "text_delta", text: `echo:${text}` };
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("dag-planner.runDag — 의존성 DAG 플래너 + 병렬 실행", () => {
  it("서로 독립인 노드는 병렬로 시작한다(한쪽이 다른쪽 시작을 기다리면 교착)", async () => {
    let started = 0;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        started += 1;
        if (started === 2) releaseGate();
        await gate; // 둘 다 시작해야만 통과 — 순차 실행이면 여기서 영원히 멈춘다.
        const last = input.messages.at(-1);
        const text = last?.role === "user" ? String(last.content) : "";
        yield {
          type: "message_start",
          messageId: "msg-1",
          meta: { provider: "fake", model: "fake-model" },
        };
        yield { type: "text_delta", text: `echo:${text}` };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };

    const results = await runDag(
      {
        nodes: [
          { id: "a", task: "task-a" },
          { id: "b", task: "task-b" },
        ],
      },
      {
        provider,
        model: "fake-model",
        systemBlocks: [],
        maxTokens: 512,
        ctx: fakeToolContext(),
      },
    );

    expect(results.get("a")).toBe("echo:task-a");
    expect(results.get("b")).toBe("echo:task-b");
  }, 5000);

  it("의존 노드는 선행 노드 완료 후 순차 실행되고, placeholder 는 선행 결과로 치환된다", async () => {
    const provider = echoProvider();

    const results = await runDag(
      {
        nodes: [
          { id: "a", task: "research topic" },
          { id: "b", task: "combine with {{a}}", dependsOn: ["a"] },
        ],
      },
      {
        provider,
        model: "fake-model",
        systemBlocks: [],
        maxTokens: 512,
        ctx: fakeToolContext(),
      },
    );

    expect(results.get("a")).toBe("echo:research topic");
    expect(results.get("b")).toBe("echo:combine with echo:research topic");
  });

  it("순환 의존성이 있으면 실행 없이 에러를 던진다", async () => {
    const provider = echoProvider();

    await expect(
      runDag(
        {
          nodes: [
            { id: "a", task: "a", dependsOn: ["b"] },
            { id: "b", task: "b", dependsOn: ["a"] },
          ],
        },
        {
          provider,
          model: "fake-model",
          systemBlocks: [],
          maxTokens: 512,
          ctx: fakeToolContext(),
        },
      ),
    ).rejects.toThrow(/순환|cycle/i);
  });
});

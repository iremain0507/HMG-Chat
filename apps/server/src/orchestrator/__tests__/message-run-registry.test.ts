import { describe, it, expect } from "vitest";
import type { ChatEvent } from "@wchat/interfaces";
import {
  startMessageRun,
  recordMessageRunEvent,
  subscribeMessageRun,
  getActiveMessageId,
  endSessionRuns,
  createMessageRunRegistry,
} from "../message-run-registry.js";
import {
  createInMemoryRuntimeBus,
  createInMemoryRuntimeStore,
} from "../runtime-bus.js";

describe("message-run-registry — 16-API-CONTRACT § GET /sessions/:id/messages/:messageId/stream", () => {
  it("등록되지 않은 messageId 는 not_found", async () => {
    const result = await subscribeMessageRun("unknown-id", "session-1");
    expect(result.kind).toBe("not_found");
  });

  it("다른 세션 소유의 messageId 는 not_found (leak 방지)", async () => {
    await startMessageRun("msg-1", "session-owner");
    const result = await subscribeMessageRun("msg-1", "session-other");
    expect(result.kind).toBe("not_found");
  });

  it("text_delta 누적 후 구독하면 contentSoFar 로 캐치업된다", async () => {
    await startMessageRun("msg-2", "session-1");
    await recordMessageRunEvent("msg-2", {
      type: "text_delta",
      text: "hello ",
    });
    await recordMessageRunEvent("msg-2", { type: "text_delta", text: "world" });

    const result = await subscribeMessageRun("msg-2", "session-1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.contentSoFar).toBe("hello world");
    }
  });

  it("stop(reason!=tool_use) 이후 구독하면 gone", async () => {
    await startMessageRun("msg-3", "session-1");
    await recordMessageRunEvent("msg-3", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await subscribeMessageRun("msg-3", "session-1");
    expect(result.kind).toBe("gone");
  });

  it("stop(reason=tool_use) 는 terminal 이 아니다 — 계속 구독 가능", async () => {
    await startMessageRun("msg-4", "session-1");
    await recordMessageRunEvent("msg-4", {
      type: "stop",
      reason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await subscribeMessageRun("msg-4", "session-1");
    expect(result.kind).toBe("ok");
  });

  it("이미 구독자가 있으면 conflict", async () => {
    await startMessageRun("msg-5", "session-1");
    const first = await subscribeMessageRun("msg-5", "session-1");
    expect(first.kind).toBe("ok");

    const second = await subscribeMessageRun("msg-5", "session-1");
    expect(second.kind).toBe("conflict");
  });

  it("unsubscribe 후에는 다시 구독 가능", async () => {
    await startMessageRun("msg-6", "session-1");
    const first = await subscribeMessageRun("msg-6", "session-1");
    expect(first.kind).toBe("ok");
    if (first.kind === "ok") {
      first.unsubscribe();
    }

    const second = await subscribeMessageRun("msg-6", "session-1");
    expect(second.kind).toBe("ok");
  });

  it("tool_use/progress/result 를 누적하면 구독 시 replayEvents(툴 카드)로 캐치업된다", async () => {
    // 새로고침/세션이동 후 진행 중 deep_research 서브에이전트 카드를 되살리려면 텍스트뿐
    // 아니라 도구 이벤트도 캐치업돼야 한다(contentSoFar 는 텍스트 전용).
    await startMessageRun("msg-replay-1", "session-replay");
    await recordMessageRunEvent("msg-replay-1", {
      type: "tool_use",
      toolCallId: "tc-1",
      name: "deep_research",
      args: { query: "q" },
    });
    await recordMessageRunEvent("msg-replay-1", {
      type: "tool_progress",
      toolCallId: "tc-1",
      stage: "researching",
      label: "1/3",
    });
    // 최신 progress 만 재생돼야 한다(중간 progress 는 덮어씀).
    await recordMessageRunEvent("msg-replay-1", {
      type: "tool_progress",
      toolCallId: "tc-1",
      stage: "researching",
      label: "2/3",
    });

    const result = await subscribeMessageRun("msg-replay-1", "session-replay");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.replayEvents).toEqual([
      {
        type: "tool_use",
        toolCallId: "tc-1",
        name: "deep_research",
        args: { query: "q" },
      },
      {
        type: "tool_progress",
        toolCallId: "tc-1",
        stage: "researching",
        label: "2/3",
      },
    ]);
  });

  it("getActiveMessageId 는 세션의 진행 중 messageId 를 돌려주고 endSessionRuns 후 사라진다", async () => {
    await startMessageRun("msg-active-1", "session-active");
    expect(await getActiveMessageId("session-active")).toBe("msg-active-1");

    await endSessionRuns("session-active");
    expect(await getActiveMessageId("session-active")).toBeUndefined();
    // endSessionRuns 는 진행 중 run 을 terminal 로 만들어 재구독 시 gone 이 된다
    // (턴 종료 시 resume 중이던 클라가 최종답변 복구 경로로 넘어가게).
    const result = await subscribeMessageRun("msg-active-1", "session-active");
    expect(result.kind).toBe("gone");
  });

  it("구독 이후 push 된 event 는 async iterable 로 전달되고 terminal stop 에서 close 된다", async () => {
    await startMessageRun("msg-7", "session-1");
    const subscription = await subscribeMessageRun("msg-7", "session-1");
    expect(subscription.kind).toBe("ok");
    if (subscription.kind !== "ok") return;

    const received: ChatEvent[] = [];
    const consume = (async () => {
      for await (const event of subscription.events) {
        received.push(event);
      }
    })();

    await recordMessageRunEvent("msg-7", { type: "text_delta", text: "later" });
    await recordMessageRunEvent("msg-7", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await consume;
    expect(received).toEqual([
      { type: "text_delta", text: "later" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// P22-T2-03 — cross-instance resume (같은 RuntimeBus store 를 공유하는 두 인스턴스).
// ---------------------------------------------------------------------------

describe("message-run-registry — cross-instance resume (P22-T2-03)", () => {
  function twoInstances(): {
    a: ReturnType<typeof createMessageRunRegistry>;
    b: ReturnType<typeof createMessageRunRegistry>;
  } {
    const store = createInMemoryRuntimeStore();
    return {
      a: createMessageRunRegistry(createInMemoryRuntimeBus(store)),
      b: createMessageRunRegistry(createInMemoryRuntimeBus(store)),
    };
  }

  it("A 에서 시작한 run 을 B 가 contentSoFar 로 캐치업하고 이후 live event 를 relay 받는다", async () => {
    const { a, b } = twoInstances();

    await a.startMessageRun("x-1", "session-1");
    await a.recordMessageRunEvent("x-1", {
      type: "text_delta",
      text: "hello ",
    });
    await a.recordMessageRunEvent("x-1", { type: "text_delta", text: "world" });

    const subscription = await b.subscribeMessageRun("x-1", "session-1");
    expect(subscription.kind).toBe("ok");
    if (subscription.kind !== "ok") return;
    expect(subscription.contentSoFar).toBe("hello world");

    const received: ChatEvent[] = [];
    const consume = (async () => {
      for await (const event of subscription.events) {
        received.push(event);
      }
    })();

    await a.recordMessageRunEvent("x-1", { type: "text_delta", text: "!" });
    await a.recordMessageRunEvent("x-1", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await consume;
    expect(received).toEqual([
      { type: "text_delta", text: "!" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    await a.close();
    await b.close();
  });

  it("B 는 A 가 모르는 messageId 에 대해 not_found", async () => {
    const { b } = twoInstances();
    const result = await b.subscribeMessageRun("x-unknown", "session-1");
    expect(result.kind).toBe("not_found");
    await b.close();
  });

  it("B 가 다른 sessionId 로 A 의 run 을 구독하면 not_found (cross-session leak 방지)", async () => {
    const { a, b } = twoInstances();
    await a.startMessageRun("x-2", "session-owner");
    const result = await b.subscribeMessageRun("x-2", "session-other");
    expect(result.kind).toBe("not_found");
    await a.close();
    await b.close();
  });

  it("A 에서 terminal 로 끝난 run 은 B 에서 gone", async () => {
    const { a, b } = twoInstances();
    await a.startMessageRun("x-3", "session-1");
    await a.recordMessageRunEvent("x-3", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = await b.subscribeMessageRun("x-3", "session-1");
    expect(result.kind).toBe("gone");
    await a.close();
    await b.close();
  });

  it("이미 다른 인스턴스가 claim 한 run 은 conflict, unsubscribe 후 재구독 가능", async () => {
    const store = createInMemoryRuntimeStore();
    const a = createMessageRunRegistry(createInMemoryRuntimeBus(store));
    const b = createMessageRunRegistry(createInMemoryRuntimeBus(store));
    const c = createMessageRunRegistry(createInMemoryRuntimeBus(store));

    await a.startMessageRun("x-4", "session-1");

    const first = await b.subscribeMessageRun("x-4", "session-1");
    expect(first.kind).toBe("ok");

    const second = await c.subscribeMessageRun("x-4", "session-1");
    expect(second.kind).toBe("conflict");

    if (first.kind === "ok") first.unsubscribe();
    // claim 해제는 공유 key 쓰기라 비동기 — 다음 tick 까지 기다린다.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const third = await c.subscribeMessageRun("x-4", "session-1");
    expect(third.kind).toBe("ok");

    await a.close();
    await b.close();
    await c.close();
  });

  it("소유 인스턴스 A 의 로컬 구독자는 event 를 중복 수신하지 않는다", async () => {
    const { a, b } = twoInstances();
    await a.startMessageRun("x-5", "session-1");

    const local = await a.subscribeMessageRun("x-5", "session-1");
    expect(local.kind).toBe("ok");
    if (local.kind !== "ok") return;

    const received: ChatEvent[] = [];
    const consume = (async () => {
      for await (const event of local.events) received.push(event);
    })();

    await a.recordMessageRunEvent("x-5", { type: "text_delta", text: "one" });
    await a.recordMessageRunEvent("x-5", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    await consume;
    expect(received).toEqual([
      { type: "text_delta", text: "one" },
      {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      },
    ]);

    await a.close();
    await b.close();
  });
});

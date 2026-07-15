import { describe, it, expect } from "vitest";
import type { ChatEvent } from "@wchat/interfaces";
import {
  startMessageRun,
  recordMessageRunEvent,
  subscribeMessageRun,
} from "../message-run-registry.js";

describe("message-run-registry — 16-API-CONTRACT § GET /sessions/:id/messages/:messageId/stream", () => {
  it("등록되지 않은 messageId 는 not_found", () => {
    const result = subscribeMessageRun("unknown-id", "session-1");
    expect(result.kind).toBe("not_found");
  });

  it("다른 세션 소유의 messageId 는 not_found (leak 방지)", () => {
    startMessageRun("msg-1", "session-owner");
    const result = subscribeMessageRun("msg-1", "session-other");
    expect(result.kind).toBe("not_found");
  });

  it("text_delta 누적 후 구독하면 contentSoFar 로 캐치업된다", () => {
    startMessageRun("msg-2", "session-1");
    recordMessageRunEvent("msg-2", { type: "text_delta", text: "hello " });
    recordMessageRunEvent("msg-2", { type: "text_delta", text: "world" });

    const result = subscribeMessageRun("msg-2", "session-1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.contentSoFar).toBe("hello world");
    }
  });

  it("stop(reason!=tool_use) 이후 구독하면 gone", () => {
    startMessageRun("msg-3", "session-1");
    recordMessageRunEvent("msg-3", {
      type: "stop",
      reason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = subscribeMessageRun("msg-3", "session-1");
    expect(result.kind).toBe("gone");
  });

  it("stop(reason=tool_use) 는 terminal 이 아니다 — 계속 구독 가능", () => {
    startMessageRun("msg-4", "session-1");
    recordMessageRunEvent("msg-4", {
      type: "stop",
      reason: "tool_use",
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const result = subscribeMessageRun("msg-4", "session-1");
    expect(result.kind).toBe("ok");
  });

  it("이미 구독자가 있으면 conflict", () => {
    startMessageRun("msg-5", "session-1");
    const first = subscribeMessageRun("msg-5", "session-1");
    expect(first.kind).toBe("ok");

    const second = subscribeMessageRun("msg-5", "session-1");
    expect(second.kind).toBe("conflict");
  });

  it("unsubscribe 후에는 다시 구독 가능", () => {
    startMessageRun("msg-6", "session-1");
    const first = subscribeMessageRun("msg-6", "session-1");
    expect(first.kind).toBe("ok");
    if (first.kind === "ok") {
      first.unsubscribe();
    }

    const second = subscribeMessageRun("msg-6", "session-1");
    expect(second.kind).toBe("ok");
  });

  it("구독 이후 push 된 event 는 async iterable 로 전달되고 terminal stop 에서 close 된다", async () => {
    startMessageRun("msg-7", "session-1");
    const subscription = subscribeMessageRun("msg-7", "session-1");
    expect(subscription.kind).toBe("ok");
    if (subscription.kind !== "ok") return;

    const received: ChatEvent[] = [];
    const consume = (async () => {
      for await (const event of subscription.events) {
        received.push(event);
      }
    })();

    recordMessageRunEvent("msg-7", { type: "text_delta", text: "later" });
    recordMessageRunEvent("msg-7", {
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

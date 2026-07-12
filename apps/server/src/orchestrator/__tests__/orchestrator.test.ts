import { describe, it, expect } from "vitest";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { hello, runTurn } from "../orchestrator.js";

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

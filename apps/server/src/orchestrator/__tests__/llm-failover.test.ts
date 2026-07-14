import { describe, it, expect } from "vitest";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { createLLMFailoverProvider } from "../llm-failover.js";

const baseInput: ChatInput = {
  model: "primary-model",
  systemBlocks: [],
  messages: [],
  maxTokens: 100,
};

function textProvider(name: string): {
  provider: LLMProvider;
  receivedInputs: ChatInput[];
} {
  const receivedInputs: ChatInput[] = [];
  return {
    provider: {
      name,
      models: [name],
      async *chat(input, _signal): AsyncIterable<ChatEvent> {
        receivedInputs.push(input);
        yield {
          type: "message_start",
          messageId: `msg_${name}`,
          meta: { provider: name, model: input.model },
        };
        yield { type: "text_delta", text: `from:${name}` };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    },
    receivedInputs,
  };
}

function throwsBeforeFirstToken(name: string): {
  provider: LLMProvider;
  receivedInputs: ChatInput[];
} {
  const receivedInputs: ChatInput[] = [];
  return {
    provider: {
      name,
      models: [name],
      // eslint-disable-next-line require-yield
      async *chat(input, _signal): AsyncIterable<ChatEvent> {
        receivedInputs.push(input);
        throw new Error(`${name}-down`);
      },
    },
    receivedInputs,
  };
}

function errorsAfterFirstToken(name: string): {
  provider: LLMProvider;
  receivedInputs: ChatInput[];
} {
  const receivedInputs: ChatInput[] = [];
  return {
    provider: {
      name,
      models: [name],
      async *chat(input, _signal): AsyncIterable<ChatEvent> {
        receivedInputs.push(input);
        yield { type: "text_delta", text: `partial:${name}` };
        yield {
          type: "error",
          error: {
            code: "MID_STREAM_FAILURE",
            category: "external-api",
            message: `${name}-broke-mid-stream`,
            retryable: false,
          },
        };
      },
    },
    receivedInputs,
  };
}

function abortedImmediately(name: string): {
  provider: LLMProvider;
  receivedInputs: ChatInput[];
} {
  const receivedInputs: ChatInput[] = [];
  return {
    provider: {
      name,
      models: [name],
      async *chat(input, _signal): AsyncIterable<ChatEvent> {
        receivedInputs.push(input);
        yield {
          type: "stop",
          reason: "aborted",
          usage: { inputTokens: 0, outputTokens: 0 },
        };
      },
    },
    receivedInputs,
  };
}

async function collect(iter: AsyncIterable<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

describe("createLLMFailoverProvider", () => {
  it("primary 가 첫 토큰 이전에 throw → secondary 로 failover(무음, secondary 결과 반환)", async () => {
    const primary = throwsBeforeFirstToken("primary");
    const secondary = textProvider("secondary");
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
      ],
      delay: async () => {},
    });

    const events = await collect(
      failover.chat(baseInput, new AbortController().signal),
    );

    expect(primary.receivedInputs).toHaveLength(1);
    expect(secondary.receivedInputs).toHaveLength(1);
    expect(events.some((e) => e.type === "error")).toBe(false);
    expect(
      events.some(
        (e) => e.type === "text_delta" && e.text === "from:secondary",
      ),
    ).toBe(true);
  });

  it("첫 토큰(text_delta) 이후 오류 → 무음전환 금지, secondary 호출 없이 error 이벤트 그대로 방출", async () => {
    const primary = errorsAfterFirstToken("primary");
    const secondary = textProvider("secondary");
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
      ],
      delay: async () => {},
    });

    const events = await collect(
      failover.chat(baseInput, new AbortController().signal),
    );

    expect(primary.receivedInputs).toHaveLength(1);
    expect(secondary.receivedInputs).toHaveLength(0);
    expect(
      events.some(
        (e) => e.type === "text_delta" && e.text === "partial:primary",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) => e.type === "error" && e.error.code === "MID_STREAM_FAILURE",
      ),
    ).toBe(true);
  });

  it("context-window fallback: candidate.model 지정 시 해당 candidate 호출은 override model 사용", async () => {
    const primary = throwsBeforeFirstToken("primary");
    const longContext = textProvider("long-context-model");
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: longContext.provider, model: "long-context-model-id" },
      ],
      delay: async () => {},
    });

    await collect(failover.chat(baseInput, new AbortController().signal));

    expect(longContext.receivedInputs).toHaveLength(1);
    expect(longContext.receivedInputs[0]?.model).toBe("long-context-model-id");
  });

  it("backoff: candidate 전환 전마다 delay(backoffMs(attempt)) 호출, 점증", async () => {
    const primary = throwsBeforeFirstToken("primary");
    const secondary = throwsBeforeFirstToken("secondary");
    const tertiary = textProvider("tertiary");
    const delayCalls: number[] = [];
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
        { provider: tertiary.provider },
      ],
      backoffMs: (attempt) => 10 * (attempt + 1),
      delay: async (ms) => {
        delayCalls.push(ms);
      },
    });

    const events = await collect(
      failover.chat(baseInput, new AbortController().signal),
    );

    expect(delayCalls).toEqual([10, 20]);
    expect(
      events.some((e) => e.type === "text_delta" && e.text === "from:tertiary"),
    ).toBe(true);
  });

  it("cooldown: 연속 실패 candidate 는 이후 chat() 호출에서 건너뜀(재시도 안 함)", async () => {
    const primary = throwsBeforeFirstToken("primary");
    const secondary = textProvider("secondary");
    let clock = 0;
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
      ],
      maxConsecutiveFailures: 1,
      cooldownMs: 1000,
      now: () => clock,
      delay: async () => {},
    });

    await collect(failover.chat(baseInput, new AbortController().signal));
    expect(primary.receivedInputs).toHaveLength(1);

    // primary 는 이제 cooldown 중 — 곧바로 다시 호출해도 primary 는 스킵되어야 함
    clock += 10;
    await collect(failover.chat(baseInput, new AbortController().signal));
    expect(primary.receivedInputs).toHaveLength(1);
    expect(secondary.receivedInputs).toHaveLength(2);

    // cooldown 만료 후에는 다시 primary 시도
    clock += 2000;
    await collect(failover.chat(baseInput, new AbortController().signal));
    expect(primary.receivedInputs).toHaveLength(2);
  });

  it("AbortSignal-safe: 이미 aborted 된 signal → candidate 호출 없이 즉시 stop:aborted, secondary 로 전환하지 않음", async () => {
    const primary = abortedImmediately("primary");
    const secondary = textProvider("secondary");
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
      ],
      delay: async () => {},
    });

    const controller = new AbortController();
    controller.abort();
    const events = await collect(failover.chat(baseInput, controller.signal));

    expect(primary.receivedInputs).toHaveLength(0);
    expect(secondary.receivedInputs).toHaveLength(0);
    expect(
      events.some((e) => e.type === "stop" && e.reason === "aborted"),
    ).toBe(true);
  });

  it("AbortSignal-safe: primary 스트림이 콘텐츠 없이 stop:aborted 로 종료되면 secondary 로 전환하지 않음", async () => {
    const primary = abortedImmediately("primary");
    const secondary = textProvider("secondary");
    const failover = createLLMFailoverProvider({
      candidates: [
        { provider: primary.provider },
        { provider: secondary.provider },
      ],
      delay: async () => {},
    });

    const events = await collect(
      failover.chat(baseInput, new AbortController().signal),
    );

    expect(primary.receivedInputs).toHaveLength(1);
    expect(secondary.receivedInputs).toHaveLength(0);
    expect(
      events.some((e) => e.type === "stop" && e.reason === "aborted"),
    ).toBe(true);
  });
});

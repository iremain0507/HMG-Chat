import { describe, it, expect } from "vitest";
import { WChatError } from "@wchat/interfaces";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { createLLMProviderRegistry } from "../llm-provider-registry.js";

function fakeProvider(
  name: string,
  models: string[],
): {
  provider: LLMProvider;
  receivedInputs: ChatInput[];
} {
  const receivedInputs: ChatInput[] = [];
  return {
    provider: {
      name,
      models,
      async *chat(input, _signal): AsyncIterable<ChatEvent> {
        receivedInputs.push(input);
        yield {
          type: "message_start",
          messageId: "msg_1",
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

describe("createLLMProviderRegistry", () => {
  it("name='registry', models=하위 provider models 의 union", () => {
    const anthropic = fakeProvider("anthropic", [
      "claude-opus-4-7",
      "claude-sonnet-4-6",
    ]);
    const gemini = fakeProvider("gemini", ["gemini-2.5-pro"]);
    const registry = createLLMProviderRegistry({
      providers: [anthropic.provider, gemini.provider],
    });

    expect(registry.name).toBe("registry");
    expect(registry.models).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-6",
      "gemini-2.5-pro",
    ]);
  });

  it("등록된 model → 해당 concrete provider 로 위임", async () => {
    const anthropic = fakeProvider("anthropic", ["claude-sonnet-4-6"]);
    const gemini = fakeProvider("gemini", ["gemini-2.5-pro"]);
    const registry = createLLMProviderRegistry({
      providers: [anthropic.provider, gemini.provider],
    });

    const controller = new AbortController();
    const events: ChatEvent[] = [];
    for await (const event of registry.chat(
      {
        model: "gemini-2.5-pro",
        systemBlocks: [],
        messages: [],
        maxTokens: 100,
      },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(anthropic.receivedInputs).toHaveLength(0);
    expect(gemini.receivedInputs).toHaveLength(1);
    expect(
      events.some((e) => e.type === "text_delta" && e.text === "from:gemini"),
    ).toBe(true);
  });

  it("미등록 model → WChatError", async () => {
    const anthropic = fakeProvider("anthropic", ["claude-sonnet-4-6"]);
    const registry = createLLMProviderRegistry({
      providers: [anthropic.provider],
    });

    const controller = new AbortController();
    const consume = async () => {
      const events: ChatEvent[] = [];
      for await (const event of registry.chat(
        {
          model: "unknown-model-xyz",
          systemBlocks: [],
          messages: [],
          maxTokens: 100,
        },
        controller.signal,
      )) {
        events.push(event);
      }
      return events;
    };

    await expect(consume()).rejects.toThrow(WChatError);
    expect(anthropic.receivedInputs).toHaveLength(0);
  });

  it("fallback provider 지정 시 미등록 model 도 fallback 으로 위임(dev-stub/단일-provider 배선 하위호환)", async () => {
    const devStub = fakeProvider("dev-stub", ["dev-stub"]);
    const registry = createLLMProviderRegistry({
      providers: [devStub.provider],
      fallback: devStub.provider,
    });

    const controller = new AbortController();
    const events: ChatEvent[] = [];
    for await (const event of registry.chat(
      {
        model: "org-configured-arbitrary-model",
        systemBlocks: [],
        messages: [],
        maxTokens: 100,
      },
      controller.signal,
    )) {
      events.push(event);
    }

    expect(devStub.receivedInputs).toHaveLength(1);
    expect(
      events.some((e) => e.type === "text_delta" && e.text === "from:dev-stub"),
    ).toBe(true);
  });
});

// P20-T2-03 (frozen 해제) — dev-stub provider 가 reasoningEffort 설정 시 reasoning_delta
//   를 방출하는지(사고 스트림). 미설정 시엔 방출하지 않아야 한다(비파괴).
import { describe, it, expect } from "vitest";
import type { ChatEvent, ChatInput } from "@wchat/interfaces";
import { createDevStubLLMProvider } from "../llm-provider-dev-stub.js";

async function collect(input: ChatInput): Promise<ChatEvent[]> {
  const provider = createDevStubLLMProvider();
  const out: ChatEvent[] = [];
  for await (const ev of provider.chat(input, new AbortController().signal)) {
    out.push(ev);
  }
  return out;
}

const base: ChatInput = {
  model: "dev-stub",
  systemBlocks: [],
  messages: [{ role: "user", content: "안녕" }],
  maxTokens: 100,
};

describe("dev-stub provider reasoning (P20-T2-03)", () => {
  it("reasoningEffort 설정 시 text_delta 이전에 reasoning_delta 를 방출한다", async () => {
    const events = await collect({ ...base, reasoningEffort: "high" });
    const reasoning = events.filter((e) => e.type === "reasoning_delta");
    expect(reasoning.length).toBeGreaterThan(0);
    expect((reasoning[0] as { text: string }).text).toContain("high");
    // 순서: reasoning_delta 가 최종 답변 text_delta 보다 앞선다.
    const rIdx = events.findIndex((e) => e.type === "reasoning_delta");
    const tIdx = events.findIndex((e) => e.type === "text_delta");
    expect(rIdx).toBeLessThan(tIdx);
    // 최종 답변(text_delta)·종단(stop)은 그대로 유지.
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "stop")).toBe(true);
  });

  it("reasoningEffort 미설정 시 reasoning_delta 를 방출하지 않는다(비파괴)", async () => {
    const events = await collect(base);
    expect(events.some((e) => e.type === "reasoning_delta")).toBe(false);
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });
});

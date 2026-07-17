import { describe, it, expect } from "vitest";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { generateFollowups } from "../followups.js";

function fakeLLMProvider(responseText: string): LLMProvider {
  return {
    name: "fake",
    models: ["fake-model"],
    async *chat(
      _input: ChatInput,
      _signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      yield { type: "text_delta", text: responseText };
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

function capturingLLMProvider(
  responseText: string,
  captured: { input?: ChatInput },
): LLMProvider {
  return {
    name: "fake",
    models: ["fake-model"],
    async *chat(
      input: ChatInput,
      _signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      captured.input = input;
      yield { type: "text_delta", text: responseText };
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("orchestrator/followups.generateFollowups", () => {
  it("LLM 이 유효한 JSON 배열(3개 이상)을 반환하면 앞 3개를 그대로 사용한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify(["질문 A?", "질문 B?", "질문 C?", "질문 D?"]),
    );

    const result = await generateFollowups({
      provider,
      model: "fake-model",
      lastUserText: "RAG 파이프라인이 뭐야?",
      lastAssistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result).toEqual(["질문 A?", "질문 B?", "질문 C?"]);
  });

  it("LLM 응답이 JSON 이 아니면(dev-stub echo 등) 조용히 빈 배열을 반환하지 않고 마지막 턴에서 파생한 3개를 반환한다(L5)", async () => {
    // dev-stub LLMProvider 는 입력 마지막 user 메시지를 그대로 echo 하므로 JSON 파싱이 실패한다.
    const provider = fakeLLMProvider("RAG 는 검색 증강 생성이다.");

    const result = await generateFollowups({
      provider,
      model: "fake-model",
      lastUserText: "RAG 파이프라인이 뭐야?",
      lastAssistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result).toHaveLength(3);
    expect(
      result.every((q) => typeof q === "string" && q.trim().length > 0),
    ).toBe(true);
  });

  it("provider.chat 이 throw 해도 조용히 실패하지 않고 파생 폴백 3개를 반환한다(L5)", async () => {
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      // eslint-disable-next-line require-yield
      async *chat(): AsyncIterable<ChatEvent> {
        throw new Error("network down");
      },
    };

    const result = await generateFollowups({
      provider,
      model: "fake-model",
      lastUserText: "RAG 파이프라인이 뭐야?",
      lastAssistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result).toHaveLength(3);
  });

  it("직전 턴이 비어 있어도(신규 세션) 항상 3개의 결정적 폴백을 반환한다", async () => {
    const provider = fakeLLMProvider("아무 응답도 없음");

    const result = await generateFollowups({
      provider,
      model: "fake-model",
      lastUserText: "",
      lastAssistantText: "",
      signal: new AbortController().signal,
    });

    expect(result).toHaveLength(3);
  });

  it("동일 입력이면 항상 동일한 폴백 결과를 반환한다(결정적, 무작위 아님)", async () => {
    const provider = fakeLLMProvider("파싱 불가 텍스트");
    const input = {
      provider,
      model: "fake-model",
      lastUserText: "다음 분기 로드맵은?",
      lastAssistantText: "3개 phase 로 나뉜다.",
      signal: new AbortController().signal,
    };

    const first = await generateFollowups(input);
    const second = await generateFollowups(input);

    expect(first).toEqual(second);
  });

  it("maxTokens 를 지정하지 않으면 안전 기본값을 사용한다(구 하드코딩 1024 아님, L2/L5)", async () => {
    const captured: { input?: ChatInput } = {};
    const provider = capturingLLMProvider(
      JSON.stringify(["a?", "b?", "c?"]),
      captured,
    );

    await generateFollowups({
      provider,
      model: "fake-model",
      lastUserText: "질문",
      lastAssistantText: "답변",
      signal: new AbortController().signal,
    });

    expect(captured.input?.maxTokens).toBe(4096);
    expect(captured.input?.maxTokens).not.toBe(1024);
  });
});

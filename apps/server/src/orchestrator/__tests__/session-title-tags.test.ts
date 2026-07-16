import { describe, it, expect } from "vitest";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { generateSessionTitleAndTags } from "../session-title-tags.js";

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

describe("orchestrator/session-title-tags.generateSessionTitleAndTags", () => {
  it("LLM 이 유효한 JSON 객체를 반환하면 title/tags 를 그대로 사용한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify({
        title: "RAG 파이프라인 논의",
        tags: ["RAG", "검색증강생성"],
      }),
    );

    const result = await generateSessionTitleAndTags({
      provider,
      model: "fake-model",
      userText: "RAG 파이프라인이 뭐야?",
      assistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      title: "RAG 파이프라인 논의",
      tags: ["RAG", "검색증강생성"],
    });
  });

  it("LLM 응답이 JSON 이 아니면(dev-stub echo 등) deriveSessionTitle 파생 제목 + 1개 태그로 폴백한다(L5)", async () => {
    // dev-stub LLMProvider 는 입력 마지막 user 메시지를 그대로 echo 하므로 JSON 파싱이 실패한다.
    const provider = fakeLLMProvider("RAG 는 검색 증강 생성이다.");

    const result = await generateSessionTitleAndTags({
      provider,
      model: "fake-model",
      userText: "RAG 파이프라인이 뭐야?",
      assistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result.title).toBe("RAG 파이프라인이 뭐야?");
    expect(result.tags).toEqual(["RAG 파이프라인이 뭐야?"]);
  });

  it("provider.chat 이 throw 해도 조용히 실패하지 않고 파생 폴백을 반환한다(L5)", async () => {
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      // eslint-disable-next-line require-yield
      async *chat(): AsyncIterable<ChatEvent> {
        throw new Error("network down");
      },
    };

    const result = await generateSessionTitleAndTags({
      provider,
      model: "fake-model",
      userText: "RAG 파이프라인이 뭐야?",
      assistantText: "RAG 는 검색 증강 생성이다.",
      signal: new AbortController().signal,
    });

    expect(result.title).toBe("RAG 파이프라인이 뭐야?");
    expect(result.tags).toHaveLength(1);
  });

  it("첫 턴이 비어 있어도 조용히 실패하지 않고 title=null, tags=[] 를 반환한다", async () => {
    const provider = fakeLLMProvider("아무 응답도 없음");

    const result = await generateSessionTitleAndTags({
      provider,
      model: "fake-model",
      userText: "",
      assistantText: "",
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ title: null, tags: [] });
  });

  it("동일 입력이면 항상 동일한 폴백 결과를 반환한다(결정적, 무작위 아님)", async () => {
    const provider = fakeLLMProvider("파싱 불가 텍스트");
    const input = {
      provider,
      model: "fake-model",
      userText: "다음 분기 로드맵은?",
      assistantText: "3개 phase 로 나뉜다.",
      signal: new AbortController().signal,
    };

    const first = await generateSessionTitleAndTags(input);
    const second = await generateSessionTitleAndTags(input);

    expect(first).toEqual(second);
  });

  it("maxTokens 를 지정하지 않으면 안전 기본값을 사용한다(구 하드코딩 1024 아님, L2/L5)", async () => {
    const captured: { input?: ChatInput } = {};
    const provider = capturingLLMProvider(
      JSON.stringify({ title: "제목", tags: ["태그"] }),
      captured,
    );

    await generateSessionTitleAndTags({
      provider,
      model: "fake-model",
      userText: "질문",
      assistantText: "답변",
      signal: new AbortController().signal,
    });

    expect(captured.input?.maxTokens).toBe(4096);
    expect(captured.input?.maxTokens).not.toBe(1024);
  });
});

import { describe, it, expect, vi } from "vitest";
import type {
  ChatEvent,
  ChatInput,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";
import { extractMemories } from "../memory-extractor.js";

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

// P14-T2-02 — ChatInput 을 캡처해 실제 전달된 maxTokens 를 단언하기 위한 provider.
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

function messages(count: number): LLMMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `메시지 ${i}`,
  }));
}

describe("memory-extractor.extractMemories", () => {
  it("세션 메시지 수가 4 미만이면 LLM 을 호출하지 않고 빈 배열을 반환한다", async () => {
    const chat = vi.fn();
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      chat,
    };

    const result = await extractMemories(
      provider,
      messages(3),
      new AbortController().signal,
    );

    expect(result).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });

  it("'사용자가 ___ 좋아한다' 패턴을 user 카테고리로 추출한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify([
        { category: "user", content: "사용자가 다크모드를 좋아한다." },
      ]),
    );

    const result = await extractMemories(
      provider,
      messages(4),
      new AbortController().signal,
    );

    expect(result).toEqual([
      { category: "user", content: "사용자가 다크모드를 좋아한다." },
    ]);
  });

  it("4 카테고리(user/feedback/project/reference)를 모두 분류한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify([
        { category: "user", content: "사용자는 백엔드 개발자다." },
        {
          category: "feedback",
          content: "이전 답변이 너무 장황하다고 평가했다.",
        },
        {
          category: "project",
          content: "현재 W-Chat 리빌드 프로젝트를 진행 중이다.",
        },
        {
          category: "reference",
          content: "https://example.com/docs 를 참고자료로 언급했다.",
        },
      ]),
    );

    const result = await extractMemories(
      provider,
      messages(5),
      new AbortController().signal,
    );

    expect(result.map((m) => m.category)).toEqual([
      "user",
      "feedback",
      "project",
      "reference",
    ]);
  });

  it("알 수 없는 category 값은 결과에서 제외한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify([
        { category: "user", content: "유효한 항목" },
        { category: "invalid-category", content: "무시되어야 함" },
      ]),
    );

    const result = await extractMemories(
      provider,
      messages(4),
      new AbortController().signal,
    );

    expect(result).toEqual([{ category: "user", content: "유효한 항목" }]);
  });

  it("content 가 빈 문자열이거나 누락된 항목은 제외한다", async () => {
    const provider = fakeLLMProvider(
      JSON.stringify([
        { category: "user", content: "  " },
        { category: "project", content: "" },
        { category: "reference" },
      ]),
    );

    const result = await extractMemories(
      provider,
      messages(4),
      new AbortController().signal,
    );

    expect(result).toEqual([]);
  });

  it("LLM 응답이 JSON 배열이 아니면 빈 배열을 반환한다 (파싱 실패 시 안전하게 무시)", async () => {
    const provider = fakeLLMProvider("죄송합니다, 추출할 정보가 없습니다.");

    const result = await extractMemories(
      provider,
      messages(4),
      new AbortController().signal,
    );

    expect(result).toEqual([]);
  });

  it("maxTokens 인자를 명시하면 ChatInput.maxTokens 에 그대로 반영된다(P14-T2-02 toolMaxTokens 배선)", async () => {
    const captured: { input?: ChatInput } = {};
    const provider = capturingLLMProvider("[]", captured);

    await extractMemories(
      provider,
      messages(4),
      new AbortController().signal,
      8000,
    );

    expect(captured.input?.maxTokens).toBe(8000);
  });

  it("maxTokens 를 지정하지 않으면 안전 기본값 4096 을 사용한다(구 하드코딩 1024 아님, L2/L5)", async () => {
    const captured: { input?: ChatInput } = {};
    const provider = capturingLLMProvider("[]", captured);

    await extractMemories(provider, messages(4), new AbortController().signal);

    expect(captured.input?.maxTokens).toBe(4096);
    expect(captured.input?.maxTokens).not.toBe(1024);
  });
});

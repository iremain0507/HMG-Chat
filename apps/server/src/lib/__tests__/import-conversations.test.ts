// import-conversations.test.ts — P22-T6-13(계약배치 C9) 대화 가져오기 파서.
//   native(conversationToJson 출력) / ChatGPT conversations.json(mapping 그래프) 두 포맷을
//   공통 ParsedConversation[] 로 정규화하는 순수 함수 계약을 고정한다.
import { describe, it, expect } from "vitest";
import {
  ImportConversationsRequestSchema,
  parseImportPayload,
} from "../import-conversations.js";

describe("parseImportPayload — native 포맷 (P22-T6-13)", () => {
  it("{title,messages} 단건을 대화 1개로 정규화한다(순서 보존)", () => {
    const parsed = parseImportPayload("native", {
      title: "원본 대화",
      messages: [
        { role: "user", content: "안녕" },
        { role: "assistant", content: "반가워요" },
      ],
    });
    expect(parsed).toEqual([
      {
        title: "원본 대화",
        messages: [
          { role: "user", content: "안녕" },
          { role: "assistant", content: "반가워요" },
        ],
      },
    ]);
  });

  it("{title,messages} 배열(여러 대화)도 각각 1개 대화로 정규화한다", () => {
    const parsed = parseImportPayload("native", [
      { title: "A", messages: [{ role: "user", content: "1" }] },
      { title: "B", messages: [{ role: "assistant", content: "2" }] },
    ]);
    expect(parsed.map((c) => c.title)).toEqual(["A", "B"]);
    expect(parsed[1]?.messages).toEqual([{ role: "assistant", content: "2" }]);
  });

  it("user/assistant 가 아닌 role 은 버린다(system/tool)", () => {
    const parsed = parseImportPayload("native", {
      title: "T",
      messages: [
        { role: "system", content: "무시" },
        { role: "user", content: "유지" },
        { role: "tool", content: "무시2" },
      ],
    });
    expect(parsed[0]?.messages).toEqual([{ role: "user", content: "유지" }]);
  });

  it("형태가 어긋나면 throw 한다(빈 대화·잘못된 payload)", () => {
    expect(() => parseImportPayload("native", { nope: 1 })).toThrow();
    expect(() => parseImportPayload("native", [])).toThrow();
  });
});

describe("parseImportPayload — ChatGPT 포맷 (P22-T6-13)", () => {
  // ChatGPT conversations.json: 대화 배열, 각 대화는 mapping 그래프(노드의 parent 포인터로 트리 구성).
  const chatgpt = [
    {
      title: "ChatGPT 대화",
      mapping: {
        root: { id: "root", message: null, parent: null, children: ["n1"] },
        n1: {
          id: "n1",
          parent: "root",
          children: ["n2"],
          message: {
            author: { role: "system" },
            content: { content_type: "text", parts: ["시스템 프롬프트"] },
          },
        },
        n2: {
          id: "n2",
          parent: "n1",
          children: ["n3"],
          message: {
            author: { role: "user" },
            content: { content_type: "text", parts: ["질문", "추가"] },
          },
        },
        n3: {
          id: "n3",
          parent: "n2",
          children: [],
          message: {
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["답변"] },
          },
        },
      },
    },
  ];

  it("mapping 을 parent 포인터로 평탄화하고 user/assistant 만 남기며 parts 를 이어붙인다", () => {
    const parsed = parseImportPayload("chatgpt", chatgpt);
    expect(parsed).toEqual([
      {
        title: "ChatGPT 대화",
        messages: [
          { role: "user", content: "질문\n추가" },
          { role: "assistant", content: "답변" },
        ],
      },
    ]);
  });

  it("대화마다 1개씩 정규화하고 빈 본문 노드는 건너뛴다", () => {
    const parsed = parseImportPayload("chatgpt", [
      ...chatgpt,
      {
        title: "둘째",
        mapping: {
          a: {
            id: "a",
            parent: null,
            children: ["b"],
            message: {
              author: { role: "user" },
              content: { content_type: "text", parts: [""] },
            },
          },
          b: {
            id: "b",
            parent: "a",
            children: [],
            message: {
              author: { role: "assistant" },
              content: { content_type: "text", parts: ["살아남음"] },
            },
          },
        },
      },
    ]);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]).toEqual({
      title: "둘째",
      messages: [{ role: "assistant", content: "살아남음" }],
    });
  });

  it("유효 메시지가 하나도 없는 대화는 결과에서 제외한다", () => {
    expect(() =>
      parseImportPayload("chatgpt", [
        {
          title: "빈 대화",
          mapping: {
            root: { id: "root", message: null, parent: null, children: [] },
          },
        },
      ]),
    ).toThrow();
  });
});

describe("ImportConversationsRequestSchema (P22-T6-13)", () => {
  it("format 은 native|chatgpt 만 허용한다", () => {
    expect(
      ImportConversationsRequestSchema.safeParse({
        format: "native",
        payload: {},
      }).success,
    ).toBe(true);
    expect(
      ImportConversationsRequestSchema.safeParse({
        format: "gemini",
        payload: {},
      }).success,
    ).toBe(false);
  });
});

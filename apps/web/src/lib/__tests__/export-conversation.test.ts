// @vitest-environment jsdom
// lib/export-conversation.ts — P10-T6-16 공유/내보내기: 대화 마크다운/JSON export.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  conversationToMarkdown,
  conversationToJson,
  downloadTextFile,
} from "../export-conversation";

const MESSAGES = [
  { role: "user" as const, content: "안녕하세요" },
  { role: "assistant" as const, content: "안녕하세요! 무엇을 도와드릴까요?" },
];

describe("conversationToMarkdown", () => {
  it("제목 헤더 + 역할별 섹션으로 마크다운을 생성한다", () => {
    const md = conversationToMarkdown("테스트 대화", MESSAGES);
    expect(md).toContain("# 테스트 대화");
    expect(md).toContain("### User");
    expect(md).toContain("안녕하세요");
    expect(md).toContain("### Assistant");
    expect(md).toContain("무엇을 도와드릴까요?");
  });
});

describe("conversationToJson", () => {
  it("title/messages 를 포함한 유효한 JSON 문자열을 생성한다", () => {
    const json = conversationToJson("테스트 대화", MESSAGES);
    const parsed = JSON.parse(json);
    expect(parsed.title).toBe("테스트 대화");
    expect(parsed.messages).toEqual(MESSAGES);
  });
});

describe("downloadTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Blob URL 을 만들어 <a download> 클릭을 트리거하고 URL 을 해제한다", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadTextFile("conversation.md", "# hi", "text/markdown");

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");

    clickSpy.mockRestore();
  });
});

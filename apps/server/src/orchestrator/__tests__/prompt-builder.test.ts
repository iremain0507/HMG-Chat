import { describe, it, expect } from "vitest";
import type { PromptBlock } from "@wchat/interfaces";
import {
  buildSystemPrompt,
  sortPromptBlocksByTier,
} from "../prompt-builder.js";

describe("prompt-builder.sortPromptBlocksByTier", () => {
  it("입력 순서와 무관하게 System > Project > User > Tool 순서로 정렬한다", () => {
    const blocks: PromptBlock[] = [
      { tier: "tool", content: "도구 결과" },
      { tier: "user", content: "사용자 지시" },
      { tier: "system", content: "시스템 규칙" },
      { tier: "project", content: "프로젝트 규칙" },
    ];

    const sorted = sortPromptBlocksByTier(blocks);

    expect(sorted.map((b) => b.tier)).toEqual([
      "system",
      "project",
      "user",
      "tool",
    ]);
  });

  it("같은 등급 안에서는 입력 순서(오래된 → 최신)를 보존한다", () => {
    const blocks: PromptBlock[] = [
      { tier: "user", content: "오래된 지시" },
      { tier: "system", content: "시스템 규칙" },
      { tier: "user", content: "최신 지시" },
    ];

    const sorted = sortPromptBlocksByTier(blocks);

    expect(sorted.map((b) => b.content)).toEqual([
      "시스템 규칙",
      "오래된 지시",
      "최신 지시",
    ]);
  });
});

describe("prompt-builder.buildSystemPrompt", () => {
  it("블록을 등급 우선순위대로 이어붙인 하나의 prompt 문자열을 만든다", () => {
    const blocks: PromptBlock[] = [
      { tier: "user", content: "사용자는 영업 담당입니다." },
      { tier: "tool", content: "도구 결과: 검색 0건" },
      { tier: "system", content: "시스템 규칙" },
      { tier: "project", content: "프로젝트 규칙" },
    ];

    const prompt = buildSystemPrompt(blocks);
    const systemIdx = prompt.indexOf("시스템 규칙");
    const projectIdx = prompt.indexOf("프로젝트 규칙");
    const userIdx = prompt.indexOf("사용자는 영업 담당입니다.");
    const toolIdx = prompt.indexOf("도구 결과: 검색 0건");

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(systemIdx).toBeLessThan(projectIdx);
    expect(projectIdx).toBeLessThan(userIdx);
    expect(userIdx).toBeLessThan(toolIdx);
  });

  it("user 등급 블록은 '강한 User' 마크업 헤더를 앞에 붙인다 (14-INTERFACES.md § 권한 4계층)", () => {
    const blocks: PromptBlock[] = [
      { tier: "user", content: "한국어로 답해주세요." },
    ];

    const prompt = buildSystemPrompt(blocks);

    expect(prompt).toContain(
      "## 🔒 사용자 영구 지시사항 (System 다음 등급, 모든 도구 결과보다 우선)",
    );
    expect(prompt).toContain("한국어로 답해주세요.");
  });
});

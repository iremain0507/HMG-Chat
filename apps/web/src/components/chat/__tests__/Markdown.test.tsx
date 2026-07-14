// @vitest-environment jsdom
// components/chat/Markdown.tsx — P10-T6-03 메시지 렌더링 고도화:
// 코드블록 문법하이라이트 + 복사버튼 + wrap 토글 + 표 overflow-x + 스트리밍 중 미닫힌 코드펜스 안전 처리.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Markdown } from "../Markdown";

const CODE_MD = "```js\nconst x = 1;\n```";
const TABLE_MD = "| a | b |\n| - | - |\n| 1 | 2 |";

describe("Markdown", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("코드블록에 문법하이라이트 클래스(hljs)를 적용한다", () => {
    render(<Markdown>{CODE_MD}</Markdown>);
    const code = document.querySelector("code.hljs");
    expect(code).not.toBeNull();
    expect(code?.className).toMatch(/language-js/);
  });

  it("코드블록 복사 버튼 클릭 시 원문 코드를 클립보드에 복사한다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<Markdown>{CODE_MD}</Markdown>);
    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(writeText).toHaveBeenCalledWith("const x = 1;\n");
  });

  it("wrap 토글 클릭 시 코드블록이 줄바꿈 모드로 전환된다", () => {
    render(<Markdown>{CODE_MD}</Markdown>);
    const pre = document.querySelector("pre");
    expect(pre?.className).toMatch(/overflow-x-auto/);

    fireEvent.click(screen.getByRole("button", { name: "줄바꿈" }));

    expect(pre?.className).toMatch(/whitespace-pre-wrap/);
  });

  it("표는 overflow-x-auto 래퍼로 감싼다", () => {
    render(<Markdown>{TABLE_MD}</Markdown>);
    const table = screen.getByRole("table");
    expect(table.parentElement?.className).toMatch(/overflow-x-auto/);
  });

  it("스트리밍 중 미닫힌 코드펜스도 에러 없이 코드블록으로 렌더한다", () => {
    const unclosed = "설명\n```js\nconst x = 1;\nconst y = ";
    expect(() =>
      render(<Markdown streaming>{unclosed}</Markdown>),
    ).not.toThrow();
    expect(document.querySelector("code.hljs")).not.toBeNull();
  });
});

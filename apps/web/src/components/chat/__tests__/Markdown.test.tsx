// @vitest-environment jsdom
// components/chat/Markdown.tsx — P10-T6-03 메시지 렌더링 고도화 + P10-T6-04 수식/다이어그램:
// 코드블록 문법하이라이트 + 복사버튼 + wrap 토글 + 표 overflow-x + 스트리밍 중 미닫힌 코드펜스 안전 처리 +
// KaTeX 수식 렌더 + Mermaid 코드→SVG(코드/다이어그램 토글).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// mermaid 는 jsdom 에 레이아웃/canvas 엔진이 없어 실렌더가 불가하므로,
// PdfRenderer.test.tsx 와 동일하게 모듈을 모킹해 render(id, code) 호출과 결과 SVG 반영만 검증한다.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string, code: string) => ({
      svg: `<svg data-testid="mermaid-svg">${code}</svg>`,
    })),
  },
}));

import { Markdown } from "../Markdown";
import type { Citation } from "../../../hooks/useSessionStream";

const CODE_MD = "```js\nconst x = 1;\n```";
const TABLE_MD = "| a | b |\n| - | - |\n| 1 | 2 |";
const MERMAID_MD = "```mermaid\ngraph TD; A-->B;\n```";

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

  it("$...$ 수식을 KaTeX 로 렌더한다", () => {
    render(<Markdown>{"질량 에너지 등가: $E=mc^2$"}</Markdown>);
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("mermaid 코드블록을 SVG 다이어그램으로 렌더한다", async () => {
    render(<Markdown>{MERMAID_MD}</Markdown>);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });
  });

  it("코드/다이어그램 토글 클릭 시 mermaid 원본 코드를 보여준다", async () => {
    render(<Markdown>{MERMAID_MD}</Markdown>);
    await waitFor(() => {
      expect(screen.getByTestId("mermaid-svg")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "코드" }));

    expect(screen.getByText(/graph TD/)).toBeInTheDocument();
    expect(screen.queryByTestId("mermaid-svg")).not.toBeInTheDocument();
  });

  it("인용 칩 hover 팝오버는 파일명·페이지·스니펫 3줄을 보여준다", () => {
    const citations: Citation[] = [
      {
        index: 1,
        source: "project",
        filename: "manual.pdf",
        page: 3,
        snippet: "42 는 만물의 답이다.",
      },
    ];
    render(<Markdown citations={citations}>{"정답은 42입니다[1]."}</Markdown>);

    const tooltip = screen.getByTestId("citation-tooltip-1");
    expect(tooltip).toHaveTextContent("manual.pdf");
    expect(tooltip).toHaveTextContent("p.3");
    expect(tooltip).toHaveTextContent("42 는 만물의 답이다.");
  });

  it("인용 칩에 키보드 포커스를 주면 툴팁이 표시되고, Escape 로 닫힌다(UX-27)", () => {
    const citations: Citation[] = [
      {
        index: 1,
        source: "project",
        filename: "manual.pdf",
        page: 3,
        snippet: "42 는 만물의 답이다.",
      },
    ];
    render(<Markdown citations={citations}>{"정답은 42입니다[1]."}</Markdown>);

    const chip = screen.getByTestId("citation-chip-1");
    const tooltip = screen.getByTestId("citation-tooltip-1");
    expect(tooltip).toHaveAttribute("data-open", "false");

    fireEvent.focus(chip);
    expect(tooltip).toHaveAttribute("data-open", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(tooltip).toHaveAttribute("data-open", "false");
  });
});

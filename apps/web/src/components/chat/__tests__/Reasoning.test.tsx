// @vitest-environment jsdom
// components/chat/Reasoning.tsx — P10-T6-05 추론 접이식(기본 접힘 + "N초 생각" 칩).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Reasoning } from "../Reasoning";

describe("Reasoning", () => {
  afterEach(() => {
    cleanup();
  });

  it("내용이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(
      <Reasoning content="" streaming={false} durationSec={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("스트리밍 중에는 기본 펼쳐져 내용을 보여주고 '생각 중…' 라벨을 표시한다", () => {
    render(<Reasoning content="분석 중..." streaming={true} durationSec={0} />);
    expect(screen.getByText("분석 중...")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /생각 중/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("스트리밍이 끝나면 기본 접힘 + 'N초 생각' 칩으로 바뀐다", () => {
    const { rerender } = render(
      <Reasoning content="분석 중..." streaming={true} durationSec={0} />,
    );
    rerender(
      <Reasoning content="분석 완료" streaming={false} durationSec={3} />,
    );

    const toggle = screen.getByRole("button", { name: "3초 생각" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("분석 완료")).not.toBeInTheDocument();
  });

  it("칩 클릭 시 펼침/접힘을 토글한다", () => {
    render(<Reasoning content="분석 완료" streaming={false} durationSec={5} />);
    const toggle = screen.getByRole("button", { name: "5초 생각" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("분석 완료")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

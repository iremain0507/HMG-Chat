// @vitest-environment jsdom
// components/chat/MessageActions.tsx — P10-T6-03 hover 액션(복사/재생성/피드백).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MessageActions } from "../MessageActions";

describe("MessageActions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("복사 버튼 클릭 시 원문 마크다운을 클립보드에 복사한다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<MessageActions role="assistant" content="**hi**" />);
    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(writeText).toHaveBeenCalledWith("**hi**");
  });

  it("assistant 메시지에서 재생성 버튼 클릭 시 onRegenerate 를 호출한다", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageActions
        role="assistant"
        content="hi"
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "재생성" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("user 메시지에는 재생성 버튼이 없다", () => {
    render(<MessageActions role="user" content="hi" />);
    expect(
      screen.queryByRole("button", { name: "재생성" }),
    ).not.toBeInTheDocument();
  });

  it("👍/👎 클릭 시 상호배타적으로 눌림 상태(aria-pressed)를 토글한다", () => {
    render(<MessageActions role="assistant" content="hi" />);
    const up = screen.getByRole("button", { name: "좋아요" });
    const down = screen.getByRole("button", { name: "싫어요" });

    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(up);
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(down).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(down);
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "true");
  });
});

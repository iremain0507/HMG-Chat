// @vitest-environment jsdom
// components/chat/ModelModePicker.tsx — P10-T6-13 모델(추론 effort 포함)+모드(Agent/Chat·웹검색) 피커.
//   org.allowedModels 가 비어있으면 렌더하지 않고, webSearchAvailable=false 면 웹검색 토글을 숨긴다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModelModePicker } from "../ModelModePicker";

const MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];

function baseProps() {
  return {
    models: MODELS,
    model: "claude-opus-4-7",
    onModelChange: vi.fn(),
    effort: "medium" as const,
    onEffortChange: vi.fn(),
    mode: "agent" as const,
    onModeChange: vi.fn(),
    webSearchAvailable: true,
    webSearch: false,
    onWebSearchChange: vi.fn(),
  };
}

describe("ModelModePicker", () => {
  afterEach(() => {
    cleanup();
  });

  it("가용 모델 목록을 렌더한다", () => {
    render(<ModelModePicker {...baseProps()} />);
    const select = screen.getByLabelText("모델 선택");
    expect(select).toHaveValue("claude-opus-4-7");
    expect(screen.getByText("claude-sonnet-4-6")).toBeInTheDocument();
  });

  it("models 가 빈 배열이면 아무 것도 렌더하지 않는다 (미가용 옵션 숨김)", () => {
    render(<ModelModePicker {...baseProps()} models={[]} />);
    expect(screen.queryByTestId("model-mode-picker")).not.toBeInTheDocument();
  });

  it("모델을 변경하면 onModelChange 가 호출된다", () => {
    const onModelChange = vi.fn();
    render(<ModelModePicker {...baseProps()} onModelChange={onModelChange} />);
    fireEvent.change(screen.getByLabelText("모델 선택"), {
      target: { value: "claude-sonnet-4-6" },
    });
    expect(onModelChange).toHaveBeenCalledWith("claude-sonnet-4-6");
  });

  it("추론 강도를 변경하면 onEffortChange 가 호출된다", () => {
    const onEffortChange = vi.fn();
    render(
      <ModelModePicker {...baseProps()} onEffortChange={onEffortChange} />,
    );
    fireEvent.change(screen.getByLabelText("추론 강도"), {
      target: { value: "high" },
    });
    expect(onEffortChange).toHaveBeenCalledWith("high");
  });

  it("모드를 변경하면 onModeChange 가 호출된다", () => {
    const onModeChange = vi.fn();
    render(<ModelModePicker {...baseProps()} onModeChange={onModeChange} />);
    fireEvent.change(screen.getByLabelText("모드 선택"), {
      target: { value: "chat" },
    });
    expect(onModeChange).toHaveBeenCalledWith("chat");
  });

  it("webSearchAvailable=false 면 웹검색 토글을 숨긴다", () => {
    render(<ModelModePicker {...baseProps()} webSearchAvailable={false} />);
    expect(
      screen.queryByTestId("model-picker-websearch"),
    ).not.toBeInTheDocument();
  });

  it("웹검색 토글을 클릭하면 onWebSearchChange 가 반전된 값으로 호출된다", () => {
    const onWebSearchChange = vi.fn();
    render(
      <ModelModePicker
        {...baseProps()}
        webSearch={false}
        onWebSearchChange={onWebSearchChange}
      />,
    );
    fireEvent.click(screen.getByTestId("model-picker-websearch"));
    expect(onWebSearchChange).toHaveBeenCalledWith(true);
  });
});

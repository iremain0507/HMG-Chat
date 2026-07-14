// @vitest-environment jsdom
// components/chat/ToolCallRenderer.tsx — 헤더(툴명+상태칩+MCP 라벨) + args/result 펼침.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToolCallRenderer } from "../ToolCallRenderer";

describe("ToolCallRenderer", () => {
  afterEach(() => cleanup());

  it("헤더에 툴명과 StatusChip(running)을 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="knowledge_search"
        args={{ query: "wchat" }}
        status="running"
      />,
    );
    expect(screen.getByText("knowledge_search")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip")).toHaveAttribute(
      "data-status",
      "running",
    );
  });

  it("MCP namespaced 툴명(mcp:{serverId}:{tool})은 'server › tool' 라벨을 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="mcp:srv-1:search"
        args={{}}
        status="running"
      />,
    );
    expect(screen.getByText("srv-1 › search")).toBeInTheDocument();
  });

  it("클릭하면 args/result 가 펼쳐지고 다시 클릭하면 접힌다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="knowledge_search"
        args={{ query: "wchat" }}
        status="done"
        result="검색 결과 3건"
      />,
    );
    expect(screen.queryByText(/"query"/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /knowledge_search/ }));
    expect(screen.getByText(/"query"/)).toBeInTheDocument();
    expect(screen.getAllByText("검색 결과 3건").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /knowledge_search/ }));
    expect(screen.queryByText(/"query"/)).not.toBeInTheDocument();
  });

  it("done 상태이고 접힌 상태면 result 요약을 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="knowledge_search"
        args={{}}
        status="done"
        result="검색 결과 3건"
      />,
    );
    expect(screen.getByText("검색 결과 3건")).toBeInTheDocument();
  });

  it("error 상태이면 재시도 칩이 보이고 클릭 시 onRetry 를 호출한다(버블링으로 펼침 토글은 트리거하지 않음)", () => {
    const onRetry = vi.fn();
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="bash"
        args={{ cmd: "ls" }}
        status="error"
        result={{ error: { code: "TOOL_NOT_FOUND", message: "no" } }}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/"cmd"/)).not.toBeInTheDocument();
  });
});

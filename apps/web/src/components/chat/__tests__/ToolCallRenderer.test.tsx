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

  it("P12 orchestrator-worker 계열({task} 단일 인자)은 '멀티에이전트' 배지를 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="research_specialist"
        args={{ task: "wchat 아키텍처를 조사해줘" }}
        status="running"
      />,
    );
    expect(screen.getByTestId("multi-agent-badge")).toHaveTextContent(
      "멀티에이전트",
    );
  });

  it("deep_research 툴은 '멀티에이전트' 배지를 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="deep_research"
        args={{ query: "wchat 아키텍처" }}
        status="running"
      />,
    );
    expect(screen.getByTestId("multi-agent-badge")).toBeInTheDocument();
  });

  it("deep_research 실행 중에는 조사 주제(query)와 병렬 조사 안내를 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="deep_research"
        args={{ query: "다크팩토리 현황과 전망" }}
        status="running"
      />,
    );
    expect(screen.getByText(/다크팩토리 현황과 전망/)).toBeInTheDocument();
    expect(screen.getByText(/병렬/)).toBeInTheDocument();
  });

  it("deep_research 완료 결과는 raw JSON 대신 References·리포트 카드로 구조화한다", () => {
    const result = {
      message: "4개 하위 질문을 조사해 리포트로 종합했습니다.",
      citations: [
        {
          index: 1,
          source: "ephemeral",
          filename: "hyundai.com",
          title: "HMGMA 자동화 라인",
          snippet: "…",
          sourceUri: "https://hyundai.com/x",
        },
        {
          index: 2,
          source: "ephemeral",
          filename: "reuters.com",
          title: "테슬라 기가팩토리",
          snippet: "…",
          sourceUri: "https://reuters.com/y",
        },
      ],
      artifact: {
        artifactId: "a1",
        artifactKind: "markdown",
        filename: "deep-research-call-1.md",
        sizeBytes: 4096,
        downloadUrl: "/api/v1/artifacts/a1/content",
      },
    };
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="deep_research"
        args={{ query: "다크팩토리" }}
        status="done"
        result={result}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /deep_research/ }));
    expect(screen.getByText("HMGMA 자동화 라인")).toBeInTheDocument();
    expect(screen.getByText("deep-research-call-1.md")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /열기/ })).toHaveAttribute(
      "href",
      "/api/v1/artifacts/a1/content",
    );
    expect(screen.queryByText(/"artifactId"/)).not.toBeInTheDocument();
  });

  it("deep_research 실행 중 progress 가 있으면 라벨(접힘)과 서브에이전트 작업목록(펼침 스윔레인)을 보여준다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="deep_research"
        args={{ query: "다크팩토리" }}
        status="running"
        progress={{
          stage: "researching",
          label: "1/2 하위질문 조사 완료",
          tasks: [
            {
              id: "sq-0",
              title: "다크팩토리 정의는?",
              status: "done",
              sourceCount: 3,
            },
            {
              id: "sq-1",
              title: "국내 사례는?",
              status: "running",
              sourceCount: 1,
            },
          ],
        }}
      />,
    );
    expect(screen.getByText(/1\/2 하위질문 조사 완료/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /deep_research/ }));
    expect(screen.getByText("다크팩토리 정의는?")).toBeInTheDocument();
    expect(screen.getByText("국내 사례는?")).toBeInTheDocument();
  });

  it("펼침 진행목록은 F07 워커 카드(StatusChip+mono 출처 N)로 렌더된다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="deep_research"
        args={{ query: "다크팩토리" }}
        status="running"
        progress={{
          stage: "researching",
          label: "1/2 하위질문 조사 완료",
          tasks: [
            {
              id: "sq-0",
              title: "다크팩토리 정의는?",
              status: "done",
              sourceCount: 3,
            },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /deep_research/ }));
    const card = screen.getByTestId("activity-worker-sq-0");
    expect(card).toHaveTextContent("다크팩토리 정의는?");
    expect(card).toHaveTextContent("출처 3");
    expect(card).toHaveTextContent("완료");
  });

  it("일반 툴(query 인자)은 '멀티에이전트' 배지를 보여주지 않는다", () => {
    render(
      <ToolCallRenderer
        toolCallId="call-1"
        name="knowledge_search"
        args={{ query: "wchat" }}
        status="running"
      />,
    );
    expect(screen.queryByTestId("multi-agent-badge")).not.toBeInTheDocument();
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

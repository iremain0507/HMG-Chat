// @vitest-environment jsdom
// P13-T6-02 — 홈(F03) 중앙 컬럼 재구현. design-reference README §Screens "홈(F03)":
// 인사 → 컴포저 트리거 → 빠른 시작 2×2 → 능력 스트립 → 최근 세션 5.
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { HomeContent, QUICK_STARTS } from "../HomeContent";

afterEach(() => {
  cleanup();
});

const NOW = new Date("2026-07-15T12:00:00.000Z").getTime();

const SESSIONS = Array.from({ length: 7 }, (_, i) => ({
  id: `s${i}`,
  title: `세션 ${i}`,
  lastMessageAt: new Date(NOW - i * 60_000).toISOString(),
  projectId: null,
  archived: false,
}));

describe("HomeContent", () => {
  it("인사 문구를 렌더한다", () => {
    render(
      <HomeContent
        userName="미"
        onNewChat={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenSession={vi.fn()}
        connectorsCount={6}
        skillsCount={13}
        agentsCount={4}
        recentSessions={[]}
        now={NOW}
      />,
    );
    expect(screen.getByText(/안녕하세요, 미님/)).toBeTruthy();
  });

  it("컴포저 트리거를 클릭하면 onNewChat 이 호출된다", () => {
    const onNewChat = vi.fn();
    render(
      <HomeContent
        userName="미"
        onNewChat={onNewChat}
        onQuickStart={vi.fn()}
        onOpenSession={vi.fn()}
        connectorsCount={0}
        skillsCount={0}
        agentsCount={0}
        recentSessions={[]}
        now={NOW}
      />,
    );
    fireEvent.click(screen.getByText(/새 채팅 시작/));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("빠른 시작 카드 4개를 렌더하고 클릭 시 정해진 prompt 로 onQuickStart 를 호출한다", () => {
    const onQuickStart = vi.fn();
    render(
      <HomeContent
        userName="미"
        onNewChat={vi.fn()}
        onQuickStart={onQuickStart}
        onOpenSession={vi.fn()}
        connectorsCount={0}
        skillsCount={0}
        agentsCount={0}
        recentSessions={[]}
        now={NOW}
      />,
    );
    expect(QUICK_STARTS).toHaveLength(4);
    const first = QUICK_STARTS[0]!;
    fireEvent.click(screen.getByText(first.title));
    expect(onQuickStart).toHaveBeenCalledWith(first.prompt);
  });

  it("능력 스트립에 커넥터·스킬 링크와 에이전트 카운트를 노출한다", () => {
    render(
      <HomeContent
        userName="미"
        onNewChat={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenSession={vi.fn()}
        connectorsCount={6}
        skillsCount={13}
        agentsCount={4}
        recentSessions={[]}
        now={NOW}
      />,
    );
    const connectorsLink = screen.getByTestId("capability-connectors");
    expect(connectorsLink).toHaveAttribute("href", "/settings/mcp");
    expect(connectorsLink).toHaveTextContent("6");
    const skillsLink = screen.getByTestId("capability-skills");
    expect(skillsLink).toHaveAttribute("href", "/settings/skills");
    expect(skillsLink).toHaveTextContent("13");
    const agents = screen.getByTestId("capability-agents");
    expect(agents).toHaveAttribute("href", "/settings/skills");
    expect(agents).toHaveTextContent("4");
  });

  it("최근 세션은 최신순 5개만 노출하고 클릭 시 onOpenSession 이 호출된다", () => {
    const onOpenSession = vi.fn();
    render(
      <HomeContent
        userName="미"
        onNewChat={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenSession={onOpenSession}
        connectorsCount={0}
        skillsCount={0}
        agentsCount={0}
        recentSessions={SESSIONS}
        now={NOW}
      />,
    );
    expect(screen.getByText("세션 0")).toBeTruthy();
    expect(screen.getByText("세션 4")).toBeTruthy();
    expect(screen.queryByText("세션 5")).toBeNull();
    fireEvent.click(screen.getByText("세션 0"));
    expect(onOpenSession).toHaveBeenCalledWith("s0");
  });

  it("최근 세션이 없으면 빈 상태 문구를 보여준다", () => {
    render(
      <HomeContent
        userName="미"
        onNewChat={vi.fn()}
        onQuickStart={vi.fn()}
        onOpenSession={vi.fn()}
        connectorsCount={0}
        skillsCount={0}
        agentsCount={0}
        recentSessions={[]}
        now={NOW}
      />,
    );
    expect(screen.getByText("최근 세션이 없습니다.")).toBeTruthy();
  });
});

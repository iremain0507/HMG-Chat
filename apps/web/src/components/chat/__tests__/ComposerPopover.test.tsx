// @vitest-environment jsdom
// components/chat/ComposerPopover.tsx — P13-T6-04 F05 핸드오프: 카테고리 탭(전체/에이전트/
//   도구/커넥터/파일/지식) + 정책 배지(읽기 전용=neutral/승인 필요=warning) + 키보드 힌트 풋터.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ComposerPopover } from "../ComposerPopover";

const CATEGORIES = [
  { id: "all", label: "전체" },
  { id: "agent", label: "에이전트" },
  { id: "tool", label: "도구" },
];

const ITEMS = [
  {
    id: "agent-1",
    label: "품질 리포트",
    subtitle: "에이전트 · 구동부품 품질팀",
  },
  {
    id: "tool-1",
    label: "defect.query",
    subtitle: "MCP: QMS",
    badge: "읽기 전용",
    badgeVariant: "neutral" as const,
  },
  {
    id: "tool-2",
    label: "work_order.update",
    subtitle: "MCP: MES",
    badge: "승인 필요",
    badgeVariant: "warning" as const,
  },
];

describe("ComposerPopover", () => {
  afterEach(() => {
    cleanup();
  });

  it("categories 를 전달하면 탭이 렌더되고 클릭 시 onCategoryChange 가 호출된다", () => {
    const onCategoryChange = vi.fn();
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
        categories={CATEGORIES}
        activeCategory="all"
        onCategoryChange={onCategoryChange}
      />,
    );
    expect(screen.getByTestId("composer-popover-tab-agent")).toBeVisible();
    fireEvent.click(screen.getByTestId("composer-popover-tab-tool"));
    expect(onCategoryChange).toHaveBeenCalledWith("tool");
  });

  it("정책 배지가 읽기 전용은 neutral, 승인 필요는 warning 스타일로 렌더된다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
      />,
    );
    const readonlyBadge = screen.getByText("읽기 전용");
    const approvalBadge = screen.getByText("승인 필요");
    expect(readonlyBadge.className).toMatch(/border-border/);
    expect(approvalBadge.className).toMatch(/border-warning/);
  });

  it("showFooterHints 가 true 면 키보드 힌트 풋터가 렌더된다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
        showFooterHints
      />,
    );
    expect(screen.getByText("↑↓ 이동")).toBeInTheDocument();
    expect(screen.getByText("Esc 닫기")).toBeInTheDocument();
  });

  it("query 를 전달하면 검색 헤더에 타이핑된 텍스트가 표시된다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
        query="품질"
      />,
    );
    expect(screen.getByTestId("composer-popover-query")).toHaveTextContent(
      "품질",
    );
  });

  it("항목의 subtitle 이 렌더된다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
      />,
    );
    expect(screen.getByText("에이전트 · 구동부품 품질팀")).toBeInTheDocument();
  });

  it("모바일(F17) 바텀시트 그래버가 항상 렌더된다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
      />,
    );
    expect(screen.getByTestId("composer-popover-grabber")).toBeInTheDocument();
  });

  it("onDismiss 가 전달되면 백드롭이 렌더되고 클릭 시 onDismiss 를 호출한다", () => {
    const onDismiss = vi.fn();
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
        onDismiss={onDismiss}
      />,
    );
    const backdrop = screen.getByTestId("composer-popover-backdrop");
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("onDismiss 가 없으면 백드롭을 렌더하지 않는다", () => {
    render(
      <ComposerPopover
        items={ITEMS}
        activeIndex={0}
        onSelect={() => {}}
        onHover={() => {}}
        label="멘션 선택"
      />,
    );
    expect(
      screen.queryByTestId("composer-popover-backdrop"),
    ).not.toBeInTheDocument();
  });
});

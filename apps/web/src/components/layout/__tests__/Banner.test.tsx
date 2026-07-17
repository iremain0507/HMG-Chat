// @vitest-environment jsdom
// components/layout/Banner.tsx — P19-T6-15: AppShell 상단 org 배너(typed, P19-T1-10 스키마 소비).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Banner, bannerKey } from "../Banner";

describe("Banner", () => {
  afterEach(() => {
    cleanup();
  });

  it("type 별 시맨틱 스타일과 title/content 를 렌더한다", () => {
    const banners = [
      {
        type: "warning" as const,
        title: "점검 안내",
        content: "곧 점검이 있습니다",
        dismissible: true,
      },
      { type: "error" as const, content: "오류 배너", dismissible: false },
    ];
    render(
      <Banner
        banners={banners}
        dismissedKeys={new Set()}
        onDismiss={vi.fn()}
      />,
    );

    const items = screen.getAllByTestId("app-banner");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("data-banner-type", "warning");
    expect(items[0]).toHaveTextContent("점검 안내");
    expect(items[0]).toHaveTextContent("곧 점검이 있습니다");
    expect(items[1]).toHaveAttribute("data-banner-type", "error");
  });

  it("dismissible 배너에만 닫기 버튼이 있고, 클릭 시 onDismiss 가 해당 key 로 호출된다", () => {
    const banners = [
      { type: "info" as const, content: "닫을 수 있음", dismissible: true },
      { type: "success" as const, content: "닫을 수 없음", dismissible: false },
    ];
    const onDismiss = vi.fn();
    render(
      <Banner
        banners={banners}
        dismissedKeys={new Set()}
        onDismiss={onDismiss}
      />,
    );

    const closeButtons = screen.getAllByLabelText("배너 닫기");
    expect(closeButtons).toHaveLength(1);

    fireEvent.click(closeButtons[0]!);
    expect(onDismiss).toHaveBeenCalledWith(bannerKey(banners[0]!, 0));
  });

  it("dismissedKeys 에 포함된 배너는 렌더되지 않고, 전부 닫히면 아무것도 렌더하지 않는다", () => {
    const banners = [
      { type: "info" as const, content: "배너 A", dismissible: true },
    ];
    const key = bannerKey(banners[0]!, 0);
    const { container } = render(
      <Banner
        banners={banners}
        dismissedKeys={new Set([key])}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("app-banner")).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });

  it("배너가 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(
      <Banner banners={[]} dismissedKeys={new Set()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

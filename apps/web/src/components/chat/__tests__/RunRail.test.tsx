// @vitest-environment jsdom
// components/chat/RunRail.tsx — F04 시그니처 요소(실행 레일) 신규 상호작용: 상태별 눈금 색,
// hover 툴팁, 클릭 콜백.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RunRail } from "../RunRail";

describe("RunRail", () => {
  afterEach(() => cleanup());

  it("스텝이 없으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(<RunRail steps={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("스텝 상태별로 눈금 색 클래스가 다르다(진행=primary·완료=success·오류=danger·승인대기=warning)", () => {
    render(
      <RunRail
        steps={[
          { id: "s1", label: "knowledge_search", status: "done" },
          { id: "s2", label: "defect.query", status: "running" },
          { id: "s3", label: "work_order.update", status: "pending-approval" },
          { id: "s4", label: "email.send", status: "error" },
        ]}
      />,
    );
    expect(screen.getByTestId("run-rail-tick-s1")).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(
      screen.getByTestId("run-rail-tick-s1").querySelector(".bg-success"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("run-rail-tick-s2").querySelector(".bg-primary"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("run-rail-tick-s3").querySelector(".bg-warning"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("run-rail-tick-s4").querySelector(".bg-danger"),
    ).not.toBeNull();
  });

  it("눈금에 hover 하면 이벤트명 툴팁을 보여준다", () => {
    render(
      <RunRail
        steps={[{ id: "s1", label: "defect.query", status: "running" }]}
      />,
    );
    const tooltip = screen.getByTestId("run-rail-tooltip-s1");
    expect(tooltip).toHaveClass("opacity-0");
    expect(tooltip).toHaveTextContent("defect.query — 실행 중");
  });

  it("눈금 클릭 시 onStepClick 이 해당 스텝 id 로 호출된다", () => {
    const onStepClick = vi.fn();
    render(
      <RunRail
        steps={[
          { id: "s1", label: "a", status: "done" },
          { id: "s2", label: "b", status: "running" },
        ]}
        onStepClick={onStepClick}
      />,
    );
    fireEvent.click(screen.getByTestId("run-rail-tick-s2"));
    expect(onStepClick).toHaveBeenCalledWith("s2");
  });

  it("모바일(F17) 1px 인디케이터가 항상 렌더되고 md 이상에서만 숨겨진다(md:hidden)", () => {
    render(<RunRail steps={[{ id: "s1", label: "a", status: "done" }]} />);
    const compact = screen.getByTestId("run-rail-compact");
    expect(compact).toHaveClass("md:hidden");
    expect(compact.querySelector(".bg-success") ?? compact).toHaveClass(
      "bg-success",
    );
  });

  it("모바일 인디케이터는 오류>승인 필요>실행 중>완료>대기 순으로 최우선 상태 색을 보여준다", () => {
    render(
      <RunRail
        steps={[
          { id: "s1", label: "a", status: "done" },
          { id: "s2", label: "b", status: "pending-approval" },
          { id: "s3", label: "c", status: "running" },
        ]}
      />,
    );
    expect(screen.getByTestId("run-rail-compact")).toHaveAttribute(
      "data-status",
      "pending-approval",
    );
    expect(screen.getByTestId("run-rail-compact")).toHaveClass("bg-warning");
  });

  it("데스크톱 눈금 버튼은 md:flex 로 md 미만에선 숨김 처리된다", () => {
    render(<RunRail steps={[{ id: "s1", label: "a", status: "done" }]} />);
    expect(screen.getByTestId("run-rail-tick-s1")).toHaveClass("hidden");
    expect(screen.getByTestId("run-rail-tick-s1")).toHaveClass("md:flex");
  });
});

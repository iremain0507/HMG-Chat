// @vitest-environment jsdom
// components/chat/ActivityPanel.tsx — F07(우패널 '활동' 탭) 신규 상호작용 RED→GREEN.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActivityPanel } from "../ActivityPanel";
import type { ToolProgressState } from "../../../hooks/useSessionStream";

afterEach(() => cleanup());

const PROGRESS: ToolProgressState = {
  stage: "researching",
  label: "2/4 하위질문 조사 완료",
  tasks: [
    {
      id: "sq-0",
      title: "글로벌 히트펌프 시장 규모",
      status: "done",
      sourceCount: 9,
    },
    {
      id: "sq-1",
      title: "주요 OEM 열관리 동향",
      status: "done",
      sourceCount: 7,
    },
    {
      id: "sq-2",
      title: "부품사 경쟁 구도",
      status: "running",
      sourceCount: 2,
    },
    { id: "sq-3", title: "규제·보조금 영향", status: "queued" },
  ],
};

describe("ActivityPanel", () => {
  it("계획 요약 배너에 서브 질문 개수를 보여준다", () => {
    render(<ActivityPanel progress={PROGRESS} />);
    expect(screen.getByTestId("activity-plan-summary")).toHaveTextContent(
      "4개",
    );
  });

  it("워커 카드마다 StatusChip 라벨과 mono 출처 카운트를 보여준다", () => {
    render(<ActivityPanel progress={PROGRESS} />);
    const done = screen.getByTestId("activity-worker-sq-0");
    expect(within(done).getByText("완료")).toBeInTheDocument();
    expect(within(done).getByText("출처 9")).toBeInTheDocument();

    const queued = screen.getByTestId("activity-worker-sq-3");
    expect(within(queued).getByText("대기")).toBeInTheDocument();
    expect(within(queued).getByText("출처 0")).toBeInTheDocument();
  });

  it("스텝 트레이스가 현재 stage 를 실행 중으로 표시한다", () => {
    render(<ActivityPanel progress={PROGRESS} />);
    expect(screen.getByTestId("activity-step-planning")).toHaveAttribute(
      "data-status",
      "done",
    );
    expect(screen.getByTestId("activity-step-researching")).toHaveAttribute(
      "data-status",
      "running",
    );
    expect(screen.getByTestId("activity-step-synthesizing")).toHaveAttribute(
      "data-status",
      "pending",
    );
  });

  it("실행 중지 버튼 클릭 시 onStop 을 호출하고, 완료 상태에서는 비활성화된다", () => {
    const onStop = vi.fn();
    const { rerender } = render(
      <ActivityPanel progress={PROGRESS} onStop={onStop} />,
    );
    fireEvent.click(screen.getByTestId("activity-stop-button"));
    expect(onStop).toHaveBeenCalledTimes(1);

    rerender(
      <ActivityPanel
        progress={{ ...PROGRESS, stage: "done" }}
        onStop={onStop}
      />,
    );
    expect(screen.getByTestId("activity-stop-button")).toBeDisabled();
  });
});

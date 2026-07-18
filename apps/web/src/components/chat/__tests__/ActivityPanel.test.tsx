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
import { ActivityPanel, WorkerCard } from "../ActivityPanel";
import type {
  ToolProgressState,
  Citation,
} from "../../../hooks/useSessionStream";

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

describe("WorkerCard 하위질문 출처 펼침(#3)", () => {
  const CITATIONS: Citation[] = [
    {
      index: 1,
      source: "ephemeral",
      title: "효모 발효 연구",
      filename: "yeast.pdf",
      sourceUri: "https://ex.com/1",
      snippet: "효모 균주와 발효 조건",
    },
    {
      index: 2,
      source: "ephemeral",
      title: "에스테르 생성",
      filename: "ester.pdf",
      snippet: "에스테르화 반응",
    },
  ];

  it("citations 가 있으면 '출처 N' 이 토글이 되고, 펼치면 실제 출처(제목/링크)를 보여준다", () => {
    render(
      <WorkerCard
        task={{
          id: "sq-0",
          title: "워시 발효",
          status: "done",
          sourceCount: 2,
        }}
        index={0}
        citations={CITATIONS}
      />,
    );
    // 접힘 상태: 출처는 아직 안 보임.
    expect(screen.queryByText("효모 발효 연구")).toBeNull();
    const toggle = screen.getByTestId("worker-sources-toggle-sq-0");
    expect(toggle).toHaveTextContent("출처 2");
    fireEvent.click(toggle);
    // 펼침: 실제 출처가 링크로 노출.
    const link = screen.getByRole("link", { name: "효모 발효 연구" });
    expect(link).toHaveAttribute("href", "https://ex.com/1");
    expect(screen.getByText("에스테르 생성")).toBeInTheDocument();
  });

  it("citations 가 없으면(실행 중 등) 토글 없이 sourceCount 만 표시한다", () => {
    render(
      <WorkerCard
        task={{
          id: "sq-1",
          title: "조사 중",
          status: "running",
          sourceCount: 0,
        }}
        index={1}
      />,
    );
    expect(screen.queryByTestId("worker-sources-toggle-sq-1")).toBeNull();
    expect(screen.getByText("출처 0")).toBeInTheDocument();
  });
});

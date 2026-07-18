// @vitest-environment jsdom
// P22-T6-06 — 멀티모델 병렬 비교(Open WebUI 파리티) 컬럼 렌더의 실 DOM 단언.
//   프레젠테이션 컴포넌트 CompareColumns 가 CompareGroup[] 을 병렬 컬럼으로 그리고,
//   컬럼별 형제 페이저(prev/next)·재생성이 서로 독립적으로 콜백을 발화하는지 검증한다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CompareColumns } from "../ChatView";
import type { CompareGroup } from "../../../hooks/useSessionStream";

afterEach(() => cleanup());

function group(overrides?: Partial<CompareGroup>): CompareGroup {
  return {
    id: "cmp-1",
    userContent: "이 프롬프트 비교",
    columns: [
      {
        model: "model-a",
        activeIndex: 0,
        answers: [{ id: "a1", content: "model-a 답변", streaming: false }],
      },
      {
        model: "model-b",
        activeIndex: 0,
        answers: [{ id: "b1", content: "model-b 답변", streaming: false }],
      },
    ],
    ...overrides,
  };
}

describe("CompareColumns", () => {
  it("선택된 2개 모델을 병렬 컬럼으로 렌더하고 각 컬럼에 모델 라벨과 해당 답변을 표시한다", () => {
    render(
      <CompareColumns
        groups={[group()]}
        isStreaming={false}
        onRegenerate={() => {}}
        onSwitchBranch={() => {}}
      />,
    );
    const colA = screen.getByTestId("compare-column-model-a");
    const colB = screen.getByTestId("compare-column-model-b");
    expect(within(colA).getByText("model-a")).toBeInTheDocument();
    expect(within(colA).getByText("model-a 답변")).toBeInTheDocument();
    expect(within(colB).getByText("model-b")).toBeInTheDocument();
    expect(within(colB).getByText("model-b 답변")).toBeInTheDocument();
    // 서로 섞이지 않는다.
    expect(within(colA).queryByText("model-b 답변")).not.toBeInTheDocument();
  });

  it("스트리밍 중인 컬럼은 shimmer 를 보이고, 유저 프롬프트를 그룹 상단에 표시한다", () => {
    const g = group({
      columns: [
        {
          model: "model-a",
          activeIndex: 0,
          answers: [{ id: "a1", content: "", streaming: true }],
        },
        {
          model: "model-b",
          activeIndex: 0,
          answers: [{ id: "b1", content: "이미 옴", streaming: false }],
        },
      ],
    });
    render(
      <CompareColumns
        groups={[g]}
        isStreaming={true}
        onRegenerate={() => {}}
        onSwitchBranch={() => {}}
      />,
    );
    expect(screen.getByText("이 프롬프트 비교")).toBeInTheDocument();
    expect(screen.getByTestId("compare-shimmer-model-a")).toBeInTheDocument();
    expect(
      screen.queryByTestId("compare-shimmer-model-b"),
    ).not.toBeInTheDocument();
  });

  it("형제 답변이 2개 이상인 컬럼은 페이저를 노출하고 prev/next 가 그 컬럼 인자로만 콜백한다", () => {
    const onSwitchBranch = vi.fn();
    const g = group({
      columns: [
        {
          model: "model-a",
          activeIndex: 1,
          answers: [
            { id: "a1", content: "첫 답", streaming: false },
            { id: "a2", content: "재생성 답", streaming: false },
          ],
        },
        {
          model: "model-b",
          activeIndex: 0,
          answers: [{ id: "b1", content: "단일", streaming: false }],
        },
      ],
    });
    render(
      <CompareColumns
        groups={[g]}
        isStreaming={false}
        onRegenerate={() => {}}
        onSwitchBranch={onSwitchBranch}
      />,
    );
    // model-a 는 페이저 노출(2/2), model-b 는 단일이라 미노출
    expect(screen.getByTestId("compare-pager-model-a")).toHaveTextContent(
      "2 / 2",
    );
    expect(
      screen.queryByTestId("compare-pager-model-b"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "model-a 이전 응답" }));
    expect(onSwitchBranch).toHaveBeenCalledWith("cmp-1", "model-a", "prev");
  });

  it("컬럼별 재생성 버튼은 해당 모델 인자로 onRegenerate 를 호출한다", () => {
    const onRegenerate = vi.fn();
    render(
      <CompareColumns
        groups={[group()]}
        isStreaming={false}
        onRegenerate={onRegenerate}
        onSwitchBranch={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "model-b 재생성" }));
    expect(onRegenerate).toHaveBeenCalledWith("cmp-1", "model-b");
  });
});

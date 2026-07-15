// @vitest-environment jsdom
// components/layout/ToastContainer.tsx — P10-T6-17 토스트 시스템 렌더러.
//   lib/toast.ts 의 pub-sub 스토어를 구독해 화면에 렌더하고, 닫기 버튼으로 dismissToast 를 호출한다.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ToastContainer } from "../ToastContainer";
import { showToast, __resetToastsForTest } from "../../../lib/toast";

describe("ToastContainer", () => {
  afterEach(() => {
    cleanup();
    __resetToastsForTest();
  });

  it("showToast 로 추가된 토스트가 렌더되고 닫기 버튼으로 제거된다", () => {
    render(<ToastContainer />);

    act(() => {
      showToast("error", "전송 실패", 0);
    });

    expect(screen.getByText("전송 실패")).toBeInTheDocument();
    expect(screen.getByTestId("toast-error")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("토스트 닫기"));
    expect(screen.queryByText("전송 실패")).not.toBeInTheDocument();
  });

  it("토스트가 없으면 아무것도 렌더하지 않는다", () => {
    render(<ToastContainer />);
    expect(screen.queryByTestId("toast-container")).not.toBeInTheDocument();
  });
});

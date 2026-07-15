// @vitest-environment jsdom
// components/chat/HitlPrompt.tsx — P13-T6-05 HITL 승인 카드(F06 핸드오프) 단위 테스트.
//   평문 액션 설명 렌더, 승인/거부 전송, 인자 인라인 편집 → modifiedArgs 반영, mono 카운트다운.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HitlPrompt } from "../HitlPrompt";

const REQUEST = {
  toolCallId: "call-1",
  toolName: "send_email",
  args: { to: "a@b.com", subject: "hi" },
  rationale: "외부로 이메일을 발송합니다.",
  expiresAt: "2026-07-14T00:05:00.000Z",
};

describe("HitlPrompt", () => {
  afterEach(() => {
    cleanup();
  });

  it("평문 액션 설명과 툴명을 렌더하고 aria-live=assertive 를 갖는다", () => {
    render(<HitlPrompt request={REQUEST} onRespond={vi.fn()} />);

    expect(screen.getByTestId("hitl-prompt")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    expect(screen.getByText(REQUEST.rationale)).toBeInTheDocument();
    expect(screen.getByText(REQUEST.toolName)).toBeInTheDocument();
  });

  it("승인 클릭 시 수정 없이 onRespond('approved')를 호출한다", () => {
    const onRespond = vi.fn();
    render(<HitlPrompt request={REQUEST} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    expect(onRespond).toHaveBeenCalledWith("approved", undefined, undefined);
  });

  it("거부 클릭 시 onRespond('denied')를 호출한다", () => {
    const onRespond = vi.fn();
    render(<HitlPrompt request={REQUEST} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "거부" }));

    expect(onRespond).toHaveBeenCalledWith("denied", undefined, undefined);
  });

  it("'수정 후 승인' 클릭 후 인자를 편집하고 다시 클릭하면 modifiedArgs 로 onRespond 를 호출한다", () => {
    const onRespond = vi.fn();
    render(<HitlPrompt request={REQUEST} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));
    fireEvent.change(screen.getByLabelText("인자 편집"), {
      target: { value: JSON.stringify({ to: "c@d.com", subject: "hi" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));

    expect(onRespond).toHaveBeenCalledWith(
      "approved",
      { to: "c@d.com", subject: "hi" },
      undefined,
    );
  });

  it("인자 편집 중 잘못된 JSON 이면 승인 시 에러를 보여주고 onRespond 를 호출하지 않는다", () => {
    const onRespond = vi.fn();
    render(<HitlPrompt request={REQUEST} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));
    fireEvent.change(screen.getByLabelText("인자 편집"), {
      target: { value: "{ not valid json" },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));

    expect(onRespond).not.toHaveBeenCalled();
    expect(
      screen.getByText("인자 JSON 형식이 올바르지 않습니다."),
    ).toBeInTheDocument();
  });

  it("편집 모드에서 '취소'를 누르면 원본 인자로 복원되고 onRespond 를 호출하지 않는다", () => {
    const onRespond = vi.fn();
    render(<HitlPrompt request={REQUEST} onRespond={onRespond} />);

    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));
    fireEvent.change(screen.getByLabelText("인자 편집"), {
      target: { value: "{ broken" },
    });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(
      screen.getByRole("button", { name: "수정 후 승인" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "승인" })).toBeInTheDocument();
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("만료 시각까지 남은 시간을 mono 카운트다운으로 표시하고 매초 갱신한다", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-07-14T00:00:00.000Z"));
      const request = { ...REQUEST, expiresAt: "2026-07-14T00:01:30.000Z" };
      render(<HitlPrompt request={request} onRespond={vi.fn()} />);

      expect(screen.getByTestId("hitl-countdown")).toHaveTextContent(
        "01:30 후 자동 거부",
      );

      act(() => {
        vi.advanceTimersByTime(30_000);
      });

      expect(screen.getByTestId("hitl-countdown")).toHaveTextContent(
        "01:00 후 자동 거부",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

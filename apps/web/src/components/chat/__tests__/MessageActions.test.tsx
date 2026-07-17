// @vitest-environment jsdom
// components/chat/MessageActions.tsx — P10-T6-03 hover 액션(복사/재생성/피드백).
//   P19-T6-07: 👍/👎 가 서버(P19-T1-07 POST /sessions/:id/messages/:messageId/feedback)에
//   영속되도록 배선(이전엔 로컬 state 뿐, 새로고침하면 사라짐).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MessageActions } from "../MessageActions";

vi.mock("../../../lib/fetch-with-refresh", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../../../lib/fetch-with-refresh";

describe("MessageActions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.mocked(apiFetch).mockReset();
  });

  it("복사 버튼 클릭 시 원문 마크다운을 클립보드에 복사한다", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<MessageActions role="assistant" content="**hi**" />);
    fireEvent.click(screen.getByRole("button", { name: "복사" }));

    expect(writeText).toHaveBeenCalledWith("**hi**");
  });

  it("assistant 메시지에서 재생성 버튼 클릭 시 onRegenerate 를 호출한다", () => {
    const onRegenerate = vi.fn();
    render(
      <MessageActions
        role="assistant"
        content="hi"
        onRegenerate={onRegenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "재생성" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("user 메시지에는 재생성 버튼이 없다", () => {
    render(<MessageActions role="user" content="hi" />);
    expect(
      screen.queryByRole("button", { name: "재생성" }),
    ).not.toBeInTheDocument();
  });

  it("👍/👎 클릭 시 상호배타적으로 눌림 상태(aria-pressed)를 토글한다", () => {
    render(<MessageActions role="assistant" content="hi" />);
    const up = screen.getByRole("button", { name: "좋아요" });
    const down = screen.getByRole("button", { name: "싫어요" });

    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(up);
    expect(up).toHaveAttribute("aria-pressed", "true");
    expect(down).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(down);
    expect(up).toHaveAttribute("aria-pressed", "false");
    expect(down).toHaveAttribute("aria-pressed", "true");
  });

  it("sessionId/messageId 가 있으면 👍 클릭 시 feedback API 를 호출하고 서버 응답으로 상태를 반영한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { messageId: "m1", rating: 1 } }),
    } as unknown as Response);

    render(
      <MessageActions
        role="assistant"
        content="hi"
        sessionId="s1"
        messageId="m1"
      />,
    );
    const up = screen.getByRole("button", { name: "좋아요" });
    fireEvent.click(up);

    expect(up).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/sessions/s1/messages/m1/feedback",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ rating: 1 }),
      }),
    );
    expect(up).toHaveAttribute("aria-pressed", "true");
  });

  it("같은 rating 을 다시 클릭하면(토글 취소) 서버가 rating:null 을 반환하고 눌림 상태가 풀린다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { messageId: "m1", rating: null } }),
    } as unknown as Response);

    render(
      <MessageActions
        role="assistant"
        content="hi"
        sessionId="s1"
        messageId="m1"
      />,
    );
    const up = screen.getByRole("button", { name: "좋아요" });
    fireEvent.click(up);
    await waitFor(() => expect(up).toHaveAttribute("aria-pressed", "false"));
  });

  it("onDelete 가 주어지면 삭제 버튼이 있고, 두 번 클릭해야 onDelete 가 호출된다 (P20-T6-05)", () => {
    const onDelete = vi.fn();
    render(
      <MessageActions role="assistant" content="hi" onDelete={onDelete} />,
    );

    const del = screen.getByRole("button", { name: "삭제" });
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();

    const confirm = screen.getByRole("button", { name: "정말 삭제?" });
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("onDelete 가 없으면 삭제 버튼이 렌더되지 않는다 (P20-T6-05)", () => {
    render(<MessageActions role="assistant" content="hi" />);
    expect(
      screen.queryByRole("button", { name: "삭제" }),
    ).not.toBeInTheDocument();
  });

  it("meta(토큰/경과시간)가 있으면 정보 버튼 클릭 시 팝오버에 토큰 수·경과시간·모델을 표시한다 (P20-T6-06)", () => {
    render(
      <MessageActions
        role="assistant"
        content="hi"
        meta={{
          model: "fake-model",
          provider: "fake",
          inputTokens: 12,
          outputTokens: 34,
          elapsedMs: 1834,
        }}
      />,
    );
    expect(
      screen.queryByTestId("message-info-popover"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "정보" }));

    const popover = screen.getByTestId("message-info-popover");
    expect(popover).toHaveTextContent("12");
    expect(popover).toHaveTextContent("34");
    expect(popover).toHaveTextContent("1.8초");
    expect(popover).toHaveTextContent("fake-model");
  });

  it("meta 가 없으면 정보 버튼이 렌더되지 않는다 (P20-T6-06)", () => {
    render(<MessageActions role="assistant" content="hi" />);
    expect(
      screen.queryByRole("button", { name: "정보" }),
    ).not.toBeInTheDocument();
  });

  it("feedback API 실패 시 낙관적 업데이트를 롤백한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    render(
      <MessageActions
        role="assistant"
        content="hi"
        sessionId="s1"
        messageId="m1"
      />,
    );
    const up = screen.getByRole("button", { name: "좋아요" });
    fireEvent.click(up);

    expect(up).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(up).toHaveAttribute("aria-pressed", "false"));
  });
});

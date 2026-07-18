// @vitest-environment jsdom
// components/chat/ChatInput.tsx — P22-T6-16 / 계약배치 C10: 입력 자동완성(ghost text).
//   타이핑을 멈추면 POST /completions 조각을 커서 뒤에 회색으로 그리고, Tab 으로 수락한다.
//   Open WebUI 의 prompt-autocomplete 인터랙션(Tab 수락 / Escape 해제)을 레퍼런스로 삼는다.
//   RED: 현재 ChatInput 에는 ghost text 오버레이도 Tab 수락 분기도 없다.
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatInput } from "../ChatInput";

const DELAY = 300;

function stubCompletionFetch(completion: string) {
  const spy = vi.fn(async (input: string) => {
    if (String(input).includes("/completions")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { completion } }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: {} }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function renderComposer(props: Record<string, unknown> = {}) {
  return render(
    <ChatInput
      sessionId="session-1"
      isStreaming={false}
      onSend={vi.fn()}
      onStop={vi.fn()}
      autocompleteEnabled
      autocompleteDelayMs={DELAY}
      {...props}
    />,
  );
}

function typeDraft(value: string) {
  const ta = screen.getByLabelText("메시지 입력") as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value } });
  return ta;
}

describe("ChatInput 자동완성(ghost text)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.unstubAllGlobals();
  });

  it("타이핑을 멈추면 이어쓰기 조각이 ghost text 로 커서 뒤에 렌더된다", async () => {
    stubCompletionFetch(" 어떻게 설정하나요?");
    renderComposer();
    typeDraft("사내 VPN 을");

    // debounce 전에는 ghost text 가 없다.
    expect(screen.queryByTestId("composer-ghost-text")).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(DELAY + 10);

    await waitFor(() => {
      const ghost = screen.getByTestId("composer-ghost-text");
      expect(ghost).toHaveTextContent("어떻게 설정하나요?");
    });
  });

  it("Tab 을 누르면 제안이 초안 뒤에 수락되고 ghost text 는 사라진다", async () => {
    stubCompletionFetch(" 어떻게 설정하나요?");
    renderComposer();
    const ta = typeDraft("사내 VPN 을");
    await vi.advanceTimersByTimeAsync(DELAY + 10);
    await waitFor(() => screen.getByTestId("composer-ghost-text"));

    fireEvent.keyDown(ta, { key: "Tab" });

    expect(ta.value).toBe("사내 VPN 을 어떻게 설정하나요?");
    await waitFor(() =>
      expect(
        screen.queryByTestId("composer-ghost-text"),
      ).not.toBeInTheDocument(),
    );
  });

  it("Escape 를 누르면 제안만 해제되고 입력한 초안은 유지된다", async () => {
    stubCompletionFetch(" 어떻게 설정하나요?");
    renderComposer();
    const ta = typeDraft("사내 VPN 을");
    await vi.advanceTimersByTimeAsync(DELAY + 10);
    await waitFor(() => screen.getByTestId("composer-ghost-text"));

    fireEvent.keyDown(ta, { key: "Escape" });

    expect(screen.queryByTestId("composer-ghost-text")).not.toBeInTheDocument();
    expect(ta.value).toBe("사내 VPN 을");
  });

  it("제안이 없을 때 Tab 은 기존 포커스 이동 동작을 막지 않는다", async () => {
    stubCompletionFetch("");
    renderComposer();
    const ta = typeDraft("사내 VPN 을");
    await vi.advanceTimersByTimeAsync(DELAY + 10);

    const ev = fireEvent.keyDown(ta, { key: "Tab" });
    // preventDefault 되지 않았다면 fireEvent 는 true 를 돌려준다(접근성: Tab 탈출 보장).
    expect(ev).toBe(true);
  });

  it("autocompleteEnabled 를 넘기지 않으면(기본 off) 자동완성 요청도 ghost text 도 없다", async () => {
    const spy = stubCompletionFetch(" 제안");
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    typeDraft("사내 VPN 을");
    await vi.advanceTimersByTimeAsync(1000);

    expect(
      spy.mock.calls.filter((c) => String(c[0]).includes("/completions")),
    ).toHaveLength(0);
    expect(screen.queryByTestId("composer-ghost-text")).not.toBeInTheDocument();
  });
});

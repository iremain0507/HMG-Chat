// @vitest-environment jsdom
// components/chat/ChatView.tsx — 18-FRONTEND-WIREFRAMES § 18.5.1 /chat/[sessionId]
// 의 Phase 2 범위(메시지 입력 → SSE 표시 → Stop 버튼) 최소 구현.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatView } from "../ChatView";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("ChatView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("메시지를 보내면 SSE text_delta 가 화면에 표시되고 스트리밍 종료 시 Stop 버튼이 사라진다", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                sseFrame("message_start", {
                  messageId: "msg-1",
                  meta: { provider: "fake", model: "fake-model" },
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "hello" })),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("stop", {
                  reason: "end_turn",
                  usage: { inputTokens: 1, outputTokens: 1 },
                }),
              ),
            );
            controller.close();
          },
        }),
      })),
    );

    render(<ChatView sessionId="session-1" />);

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
  });

  it("스트리밍 중 Stop 버튼을 클릭하면 즉시 사라지고 DELETE /active-run 을 호출한다", async () => {
    let releaseStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const streamingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            sseFrame("message_start", {
              messageId: "msg-1",
              meta: { provider: "fake", model: "fake-model" },
            }),
          ),
        );
        releaseStream = () => controller.close();
      },
    });

    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return { ok: true, json: async () => ({ data: { cancelled: true } }) };
      }
      return { body: streamingBody };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/active-run",
      expect.objectContaining({ method: "DELETE" }),
    );

    releaseStream?.();
  });

  it("user 메시지는 우측 정렬, assistant 메시지는 풀폭(버블 배경 없음)으로 렌더한다", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "hello" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("stop", { reason: "end_turn" })),
            );
            controller.close();
          },
        }),
      })),
    );

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    const userItem = document.querySelector('[data-role="user"]');
    expect(userItem?.className).toMatch(/justify-end/);

    const assistantContent = document.querySelector(
      '[data-role="assistant"] .min-w-0',
    );
    expect(assistantContent?.querySelector(".bg-primary")).toBeNull();
  });

  it("assistant 메시지에 hover 액션(재생성)이 있고 클릭 시 마지막 user 메시지를 재전송한다", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("text_delta", { text: "hello" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("stop", { reason: "end_turn" })),
          );
          controller.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "재생성" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages",
        expect.objectContaining({
          body: JSON.stringify({ content: "hi" }),
        }),
      );
    });
  });

  it("첫 토큰 도착 전에는 shimmer 스켈레톤을 보여주고 델타 도착 시 사라진다", async () => {
    const encoder = new TextEncoder();
    let sendDelta: (() => void) | undefined;
    const streamingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
        );
        sendDelta = () => {
          controller.enqueue(
            encoder.encode(sseFrame("text_delta", { text: "hello" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("stop", { reason: "end_turn" })),
          );
          controller.close();
        };
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ body: streamingBody })),
    );

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await screen.findByTestId("shimmer");

    sendDelta?.();

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("shimmer")).not.toBeInTheDocument();
  });

  it("스크롤이 하단에서 벗어나면 자동추종을 해제하고 '최신으로↓' pill 을 보여준다; 클릭 시 하단으로 스크롤한다", async () => {
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "hello" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("stop", { reason: "end_turn" })),
            );
            controller.close();
          },
        }),
      })),
    );

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("hello")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("button", { name: "최신으로↓" }),
    ).not.toBeInTheDocument();

    const scrollEl = screen.getByTestId("chat-scroll");
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      value: 500,
      configurable: true,
    });
    scrollEl.scrollTop = 0;
    fireEvent.scroll(scrollEl);

    const pill = await screen.findByRole("button", { name: "최신으로↓" });

    fireEvent.click(pill);

    expect(scrollEl.scrollTop).toBe(1000);
    expect(
      screen.queryByRole("button", { name: "최신으로↓" }),
    ).not.toBeInTheDocument();
  });
});

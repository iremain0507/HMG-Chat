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
});

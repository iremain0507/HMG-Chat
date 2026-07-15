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
  act,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChatView } from "../ChatView";
import { ToastContainer } from "../../layout/ToastContainer";
import { __resetToastsForTest } from "../../../lib/toast";

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
    __resetToastsForTest();
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

  it("스트리밍 컨테이너에 role=log + aria-live=polite + aria-atomic=false 가 있다", () => {
    render(<ChatView sessionId="session-1" />);

    const scrollEl = screen.getByTestId("chat-scroll");
    expect(scrollEl).toHaveAttribute("role", "log");
    expect(scrollEl).toHaveAttribute("aria-live", "polite");
    expect(scrollEl).toHaveAttribute("aria-atomic", "false");
  });

  it("빠른 연속 text_delta 에서도 SR 안내(announcer)는 즉시 갱신되지 않고 디바운스된 뒤 반영된다", async () => {
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
              encoder.encode(sseFrame("text_delta", { text: "h" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "e" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "l" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "l" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "o" })),
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

    const announcer = screen.getByTestId("stream-announcer");
    expect(announcer).not.toHaveTextContent("hello");

    await waitFor(
      () => {
        expect(announcer).toHaveTextContent("hello");
      },
      { timeout: 2000 },
    );
  });

  it("스트리밍 종료로 Stop 버튼이 사라져 포커스를 잃으면 입력창으로 포커스를 복귀시킨다(새 turn 포커스 탈취 방지)", async () => {
    let releaseStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const streamingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
        );
        releaseStream = () => {
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

    const stopButton = await screen.findByRole("button", { name: "Stop" });
    stopButton.focus();
    expect(document.activeElement).toBe(stopButton);

    releaseStream?.();

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Stop" }),
      ).not.toBeInTheDocument();
    });

    expect(document.activeElement).toBe(screen.getByLabelText("메시지 입력"));
  });

  it("tool_use/tool_result 가 스트림 위치에 인터리브되어 running→done 상태로 렌더된다", async () => {
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
              encoder.encode(sseFrame("text_delta", { text: "확인해볼게요." })),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("tool_use", {
                  toolCallId: "call-1",
                  name: "knowledge_search",
                  args: { query: "wchat" },
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("tool_result", {
                  toolCallId: "call-1",
                  content: "검색 결과 3건",
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "찾았습니다." })),
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
      target: { value: "검색해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("knowledge_search")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByTestId("status-chip")).toHaveAttribute(
        "data-status",
        "done",
      );
    });
    expect(screen.getByText("확인해볼게요.")).toBeInTheDocument();
    expect(screen.getByText("찾았습니다.")).toBeInTheDocument();

    // Run Rail — 도구를 쓴 턴 좌측에 눈금(F04 시그니처 요소)이 붙고, 완료 상태를 반영한다.
    expect(screen.getByTestId("run-rail")).toBeInTheDocument();
    expect(screen.getByTestId("run-rail-tick-call-1")).toHaveAttribute(
      "data-status",
      "done",
    );
  });

  it("tool_result 가 error content 를 담으면 재시도 칩이 렌더되고 클릭 시 마지막 user 메시지를 재전송한다", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
          );
          controller.enqueue(
            encoder.encode(
              sseFrame("tool_use", {
                toolCallId: "call-1",
                name: "bash",
                args: { cmd: "ls" },
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(
              sseFrame("tool_result", {
                toolCallId: "call-1",
                content: { error: { code: "TOOL_NOT_FOUND", message: "no" } },
              }),
            ),
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
      target: { value: "실행해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("status-chip")).toHaveAttribute(
        "data-status",
        "error",
      );
    });

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages",
        expect.objectContaining({
          body: JSON.stringify({ content: "실행해줘" }),
        }),
      );
    });
  });

  // P10-T6-17 — 에러/신뢰: 원인별 에러배너 + 재시도(재시도 가능 코드만) + 토스트 + 오프라인.
  it("retryable:true 인 error 이벤트는 재시도 버튼과 rate-limit 안내를 렌더하고, 클릭 시 재전송한다", async () => {
    const fetchMock = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
          );
          controller.enqueue(
            encoder.encode(
              sseFrame("error", {
                error: {
                  code: "RATE_LIMITED",
                  category: "rate-limit",
                  message: "요청이 너무 많습니다",
                  retryable: true,
                },
              }),
            ),
          );
          controller.close();
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "다시 물어볼게" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("요청이 너무 많습니다")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "재시도" })).toBeInTheDocument();

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "재시도" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages",
        expect.objectContaining({
          body: JSON.stringify({ content: "다시 물어볼게" }),
        }),
      );
    });
  });

  it("retryable:false 인 error 이벤트(크레딧 부족 등)는 재시도 버튼을 노출하지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("error", {
                  error: {
                    code: "QUOTA_EXCEEDED",
                    category: "auth",
                    message: "크레딧이 부족합니다",
                    retryable: false,
                  },
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
      expect(screen.getByText("크레딧이 부족합니다")).toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: "재시도" }),
    ).not.toBeInTheDocument();
  });

  it("오프라인이 되면 배너가 렌더되고 전송 버튼이 비활성화된다", async () => {
    render(<ChatView sessionId="session-1" />);

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("offline-banner")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "hi" },
    });
    expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();

    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => {
      expect(screen.queryByTestId("offline-banner")).not.toBeInTheDocument();
    });
  });

  it("hitl_request 이벤트가 오면 HitlPrompt 카드가 렌더되고, 승인 클릭 시 POST /messages/hitl 을 호출한다", async () => {
    let releaseStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const streamingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
        );
        controller.enqueue(
          encoder.encode(
            sseFrame("hitl_request", {
              toolCallId: "call-1",
              toolName: "send_email",
              args: { to: "a@b.com" },
              rationale: "외부로 이메일을 발송합니다.",
              expiresAt: "2026-07-14T00:05:00.000Z",
            }),
          ),
        );
        releaseStream = () => {
          controller.enqueue(
            encoder.encode(
              sseFrame("hitl_resolved", {
                toolCallId: "call-1",
                decision: "approved",
              }),
            ),
          );
          controller.enqueue(
            encoder.encode(sseFrame("stop", { reason: "end_turn" })),
          );
          controller.close();
        };
      },
    });

    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && String(_url).endsWith("/messages/hitl")) {
        return { ok: true, json: async () => ({ data: { delivered: true } }) };
      }
      return { body: streamingBody };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "메일 보내줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("hitl-prompt")).toBeInTheDocument();
    });
    expect(screen.getByText("외부로 이메일을 발송합니다.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "승인" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages/hitl",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ toolCallId: "call-1", decision: "approved" }),
        }),
      );
    });

    releaseStream?.();
    await waitFor(() => {
      expect(screen.queryByTestId("hitl-prompt")).not.toBeInTheDocument();
    });
  });

  it("HitlPrompt 에서 인자를 수정하고 승인하면 modifiedArgs 를 담아 POST 한다", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && String(_url).endsWith("/messages/hitl")) {
        return { ok: true, json: async () => ({ data: { delivered: true } }) };
      }
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("hitl_request", {
                  toolCallId: "call-1",
                  toolName: "send_email",
                  args: { to: "a@b.com" },
                  rationale: "외부로 이메일을 발송합니다.",
                  expiresAt: "2026-07-14T00:05:00.000Z",
                }),
              ),
            );
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "메일 보내줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("hitl-prompt")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));
    fireEvent.change(screen.getByLabelText("인자 편집"), {
      target: { value: JSON.stringify({ to: "c@d.com" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "수정 후 승인" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages/hitl",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            toolCallId: "call-1",
            decision: "approved",
            modifiedArgs: { to: "c@d.com" },
          }),
        }),
      );
    });
  });

  it("citation 이벤트가 오면 [N] 칩과 Reference 푸터가 렌더되고, 칩 클릭 시 해당 참조 항목이 포커스된다", async () => {
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
              encoder.encode(
                sseFrame("text_delta", { text: "정답은 42입니다[1]." }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("citation", {
                  index: 1,
                  source: "project",
                  documentId: "doc-1",
                  filename: "manual.pdf",
                  page: 3,
                  snippet: "42 는 만물의 답이다.",
                }),
              ),
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
      target: { value: "질문" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("citation-chip-1")).toBeInTheDocument();
    });
    const footer = screen.getByTestId("citation-reference-footer");
    expect(footer).toHaveTextContent("manual.pdf");
    expect(footer).toHaveTextContent("p.3");
    const refItem = screen.getByTestId("citation-ref-1");
    expect(refItem).toHaveAttribute("data-focused", "false");

    fireEvent.click(screen.getByTestId("citation-chip-1"));

    expect(refItem).toHaveAttribute("data-focused", "true");

    // design-reference §6 CitationChip: 클릭 시 우패널 '출처' 탭 활성 + 원문 하이라이트.
    expect(screen.getByTestId("artifact-panel-tab-sources")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const sourceItem = screen.getByTestId("source-item-1");
    expect(sourceItem).toHaveAttribute("data-focused", "true");
    expect(sourceItem).toHaveTextContent("manual.pdf");
  });

  it("우패널 출처 하이라이트는 클릭 2초 후 자동으로 사라진다(primary-100 페이드)", async () => {
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
              encoder.encode(
                sseFrame("text_delta", { text: "정답은 42입니다[1]." }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("citation", {
                  index: 1,
                  source: "project",
                  documentId: "doc-1",
                  filename: "manual.pdf",
                  page: 3,
                  snippet: "42 는 만물의 답이다.",
                }),
              ),
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
      target: { value: "질문" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("citation-chip-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("citation-chip-1"));
    expect(screen.getByTestId("source-item-1")).toHaveAttribute(
      "data-focused",
      "true",
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("source-item-1")).toHaveAttribute(
          "data-focused",
          "false",
        );
      },
      { timeout: 2600 },
    );
  }, 5000);

  it("artifact_created 이벤트가 오면 아티팩트 패널이 자동으로 열리고 미리보기/코드 토글이 동작한다", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).endsWith("/content")) {
        return { ok: true, text: async () => "# 원본 콘텐츠" };
      }
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("artifact_created", {
                  artifactId: "artifact-1",
                  artifactKind: "markdown",
                  filename: "report.md",
                  sizeBytes: 100,
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(sseFrame("stop", { reason: "end_turn" })),
            );
            controller.close();
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <>
        <ChatView sessionId="session-1" />
        <ToastContainer />
      </>,
    );
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "보고서 만들어줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    });
    expect(screen.getAllByText("report.md").length).toBeGreaterThan(0);

    // design-reference §4: artifact_created → 우패널 '아티팩트' 탭 자동 오픈 + 토스트.
    expect(screen.getByTestId("artifact-panel-tab-artifacts")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("toast-success")).toHaveTextContent("report.md");

    fireEvent.click(screen.getByRole("button", { name: "코드" }));
    await waitFor(() => {
      expect(screen.getByTestId("artifact-code-view")).toHaveTextContent(
        "원본 콘텐츠",
      );
    });
  });

  it("artifact_created 가 두 번 오면 버전 페이저로 이전 아티팩트를 탐색할 수 있다", async () => {
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
              encoder.encode(
                sseFrame("artifact_created", {
                  artifactId: "artifact-1",
                  artifactKind: "markdown",
                  filename: "report-v1.md",
                  sizeBytes: 100,
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                sseFrame("artifact_created", {
                  artifactId: "artifact-2",
                  artifactKind: "markdown",
                  filename: "report-v2.md",
                  sizeBytes: 200,
                }),
              ),
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
      target: { value: "보고서 만들어줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-version-pager")).toHaveTextContent(
        "2 / 2",
      );
    });
    expect(screen.getAllByText("report-v2.md").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "이전 버전" }));

    expect(screen.getByTestId("artifact-version-pager")).toHaveTextContent(
      "1 / 2",
    );
    expect(screen.getAllByText("report-v1.md").length).toBeGreaterThan(0);
  });

  it("Cmd+\\ 로 아티팩트 패널을 닫고 다시 열 수 있다", async () => {
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
              encoder.encode(
                sseFrame("artifact_created", {
                  artifactId: "artifact-1",
                  artifactKind: "markdown",
                  filename: "report.md",
                  sizeBytes: 100,
                }),
              ),
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
      target: { value: "보고서 만들어줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.queryByTestId("artifact-panel")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
  });

  it("첨부 파일을 드롭해 업로드한 뒤 전송하면 attachments 가 POST body 에 포함된다 (P10-T6-11)", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/uploads") {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              id: "upload-9",
              filename: "notes.md",
              mimeType: "text/markdown",
            },
          }),
        };
      }
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("text_delta", { text: "확인" })),
            );
            controller.enqueue(
              encoder.encode(sseFrame("stop", { reason: "end_turn" })),
            );
            controller.close();
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);

    const dropzone = screen.getByTestId("composer-dropzone");
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "이 문서 요약해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            content: "이 문서 요약해줘",
            attachments: [{ uploadId: "upload-9" }],
          }),
        }),
      );
    });
  });

  it("헤더 프로젝트 피커에서 프로젝트를 선택하면 세션의 projectId 를 PATCH 한다 (P10-T6-14)", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      const u = String(url);
      if (u === "/api/v1/projects") {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "proj-1",
                name: "영업 RFP 분석",
                description: null,
                visibility: "private",
                orgUnitId: null,
                ownerId: "user-1",
                createdAt: "2026-04-01T00:00:00Z",
              },
            ],
          }),
        };
      }
      if (u === "/api/v1/sessions/session-1" && opts?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            data: { id: "session-1", projectId: "proj-1" },
          }),
        };
      }
      if (u === "/api/v1/sessions/session-1") {
        return {
          ok: true,
          json: async () => ({
            data: { id: "session-1", projectId: null, createdAt: "x" },
          }),
        };
      }
      return {
        body: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /프로젝트 없음/ }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /프로젝트 없음/ }));
    fireEvent.click(screen.getByText("영업 RFP 분석"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ projectId: "proj-1" }),
        }),
      );
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /영업 RFP 분석/ }),
      ).toBeInTheDocument();
    });
  });

  it("'/memories' 슬래시 커맨드를 선택하면 메모리 패널이 열리고 닫기로 다시 닫을 수 있다 (P10-T6-14)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/memories")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "mem-1",
                userId: "user-1",
                category: "user",
                content: "사용자는 데이터 과학자다",
                source: "auto-extract",
                sessionId: null,
                pinned: false,
                metadata: null,
                createdAt: "2026-04-01T00:00:00Z",
                updatedAt: "2026-04-01T00:00:00Z",
              },
            ],
          }),
        };
      }
      return {
        body: new ReadableStream<Uint8Array>({ start: (c) => c.close() }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ChatView sessionId="session-1" />);

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "/memories" },
    });
    fireEvent.click(screen.getByTestId("composer-popover-item-memories"));

    await waitFor(() => {
      expect(screen.getByTestId("memory-panel")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText("사용자는 데이터 과학자다")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("memory-panel")).not.toBeInTheDocument();
  });

  it("user 메시지를 편집하면 새 분기로 전환되고, 페이저로 형제 분기 사이를 오갈 수 있다 (P10-T6-15)", async () => {
    const encoder = new TextEncoder();
    const fetchMock = vi.fn(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(sseFrame("message_start", { messageId: "msg-1" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("text_delta", { text: "첫 응답" })),
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
      target: { value: "원본 질문" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("첫 응답")).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId("message-branch-pager"),
    ).not.toBeInTheDocument();

    fetchMock.mockImplementationOnce(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(sseFrame("message_start", { messageId: "msg-2" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("text_delta", { text: "편집된 응답" })),
          );
          controller.enqueue(
            encoder.encode(sseFrame("stop", { reason: "end_turn" })),
          );
          controller.close();
        },
      }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    fireEvent.change(screen.getByLabelText("메시지 편집"), {
      target: { value: "편집된 질문" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(screen.getByText("편집된 응답")).toBeInTheDocument();
    });
    expect(screen.getByText("편집된 질문")).toBeInTheDocument();
    expect(screen.queryByText("원본 질문")).not.toBeInTheDocument();
    expect(screen.getByTestId("message-branch-pager")).toHaveTextContent(
      "2 / 2",
    );

    fireEvent.click(screen.getByRole("button", { name: "이전 분기" }));

    await waitFor(() => {
      expect(screen.getByText("원본 질문")).toBeInTheDocument();
    });
    expect(screen.getByText("첫 응답")).toBeInTheDocument();
    expect(screen.getByTestId("message-branch-pager")).toHaveTextContent(
      "1 / 2",
    );
  });
});

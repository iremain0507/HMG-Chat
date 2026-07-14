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

    fireEvent.click(screen.getByRole("button", { name: "수정" }));
    fireEvent.change(screen.getByLabelText("인자 편집"), {
      target: { value: JSON.stringify({ to: "c@d.com" }) },
    });
    fireEvent.click(screen.getByRole("button", { name: "승인" }));

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
  });

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

    render(<ChatView sessionId="session-1" />);
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "보고서 만들어줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    });
    expect(screen.getAllByText("report.md").length).toBeGreaterThan(0);

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
});

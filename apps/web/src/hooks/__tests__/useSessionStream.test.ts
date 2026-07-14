// @vitest-environment jsdom
// hooks/useSessionStream.ts — 16-API-CONTRACT § POST /sessions/:id/messages (SSE) +
// DELETE /sessions/:id/active-run 를 소비하는 client hook. 18-FRONTEND-WIREFRAMES §
// 18.6.3 stream 처리 reducer(state flow)를 Phase 2 범위(message_start/text_delta/stop/error)로 구현.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStream } from "../useSessionStream";

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(encoder.encode(frame));
      }
      controller.close();
    },
  });
}

describe("useSessionStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("send 후 SSE message_start/text_delta/stop 흐름을 파싱해 assistant 메시지를 누적하고 isStreaming 을 false 로 되돌린다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", {
            messageId: "msg-1",
            meta: { provider: "fake", model: "fake-model" },
          }),
          sseFrame("text_delta", { text: "hello" }),
          sseFrame("stop", {
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(result.current.isStreaming).toBe(false);
    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.content).toBe("hello");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "text/event-stream" }),
        body: JSON.stringify({ content: "hello" }),
      }),
    );
  });

  it("stop() 호출 시 즉시 isStreaming 이 false 가 되고 DELETE /active-run 을 호출한다 (Stop 클릭 시 즉시 중단)", async () => {
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

    const { result } = renderHook(() => useSessionStream("session-1"));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send("hi");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.isStreaming).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/active-run",
      expect.objectContaining({ method: "DELETE" }),
    );

    releaseStream?.();
    await act(async () => {
      await sendPromise.catch(() => {});
    });
  });

  it("tool_use/tool_result 이벤트를 parts 에 순서대로 누적하고 상태를 running→done 으로 전이시킨다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", {
            messageId: "msg-1",
            meta: { provider: "fake", model: "fake-model" },
          }),
          sseFrame("text_delta", { text: "확인해볼게요. " }),
          sseFrame("tool_use", {
            toolCallId: "call-1",
            name: "knowledge_search",
            args: { query: "wchat" },
          }),
          sseFrame("tool_result", {
            toolCallId: "call-1",
            content: "검색 결과 3건",
          }),
          sseFrame("text_delta", { text: "결과를 찾았습니다." }),
          sseFrame("stop", {
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("검색해줘");
    });

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.parts).toEqual([
      { type: "text", text: "확인해볼게요. " },
      {
        type: "tool",
        toolCallId: "call-1",
        name: "knowledge_search",
        args: { query: "wchat" },
        status: "done",
        result: "검색 결과 3건",
      },
      { type: "text", text: "결과를 찾았습니다." },
    ]);
  });

  it("tool_result 의 content 가 error 를 담으면 해당 tool part 의 상태가 error 가 된다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("tool_use", {
            toolCallId: "call-1",
            name: "bash",
            args: { cmd: "ls" },
          }),
          sseFrame("tool_result", {
            toolCallId: "call-1",
            content: { error: { code: "TOOL_NOT_FOUND", message: "no" } },
          }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("실행해줘");
    });

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.parts?.[0]).toMatchObject({
      type: "tool",
      status: "error",
    });
  });
});

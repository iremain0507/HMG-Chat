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

  it("send 에 attachments 를 전달하면 POST body 에 그대로 포함된다 (P10-T6-11)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "확인했습니다" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("이 문서 요약해줘", [{ uploadId: "upload-1" }]);
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          content: "이 문서 요약해줘",
          attachments: [{ uploadId: "upload-1" }],
        }),
      }),
    );
  });

  it("send 에 model/mode 옵션을 전달하면 POST body 에 반영된다 (P10-T6-13)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "확인했습니다" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("웹에서 최신 뉴스 찾아줘", undefined, {
        model: "claude-opus-4-7",
        mode: "chat",
        reasoningEffort: "high",
        webSearch: true,
      });
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          content: "웹에서 최신 뉴스 찾아줘",
          model: "claude-opus-4-7",
          mode: "chat",
          reasoningEffort: "high",
          webSearch: true,
        }),
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

  it("citation 이벤트를 받으면 해당 assistant 메시지의 citations 배열에 순서대로 누적한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "정답은 42입니다[1]." }),
          sseFrame("citation", {
            index: 1,
            source: "project",
            documentId: "doc-1",
            filename: "manual.pdf",
            page: 3,
            snippet: "42 는 만물의 답이다.",
          }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("질문");
    });

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.citations).toEqual([
      {
        index: 1,
        source: "project",
        documentId: "doc-1",
        filename: "manual.pdf",
        page: 3,
        snippet: "42 는 만물의 답이다.",
      },
    ]);
  });

  it("artifact_created 이벤트를 받으면 artifacts 배열에 순서대로 누적한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("artifact_created", {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 120,
          }),
          sseFrame("artifact_created", {
            artifactId: "artifact-2",
            artifactKind: "pdf",
            filename: "report.pdf",
            sizeBytes: 4096,
            downloadUrl: "https://s3.example.com/artifact-2",
          }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("보고서 만들어줘");
    });

    expect(result.current.artifacts).toEqual([
      {
        artifactId: "artifact-1",
        artifactKind: "markdown",
        filename: "report.md",
        sizeBytes: 120,
      },
      {
        artifactId: "artifact-2",
        artifactKind: "pdf",
        filename: "report.pdf",
        sizeBytes: 4096,
        downloadUrl: "https://s3.example.com/artifact-2",
      },
    ]);
  });

  it("hitl_request 이벤트를 받으면 hitlRequest 상태를 채우고, hitl_resolved 로 같은 toolCallId 가 도착하면 비운다", async () => {
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

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ body: streamingBody })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    let sendPromise!: Promise<void>;
    await act(async () => {
      sendPromise = result.current.send("보내줘");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.hitlRequest).toEqual({
      toolCallId: "call-1",
      toolName: "send_email",
      args: { to: "a@b.com" },
      rationale: "외부로 이메일을 발송합니다.",
      expiresAt: "2026-07-14T00:05:00.000Z",
    });

    await act(async () => {
      releaseStream?.();
      await sendPromise;
    });

    expect(result.current.hitlRequest).toBeNull();
  });

  it("respondHitl 은 대기 중인 hitlRequest 의 toolCallId 로 POST /messages/hitl 을 호출한다", async () => {
    let releaseStream: (() => void) | undefined;
    const encoder = new TextEncoder();
    const streamingBody = new ReadableStream<Uint8Array>({
      start(controller) {
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
        releaseStream = () => controller.close();
      },
    });

    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST" && String(_url).endsWith("/messages/hitl")) {
        return { ok: true, json: async () => ({ data: { delivered: true } }) };
      }
      return { body: streamingBody };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      void result.current.send("보내줘");
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.respondHitl("approved", { to: "c@d.com" });
    });

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

    releaseStream?.();
  });

  it("editMessage 는 대상 user 메시지의 형제 분기를 새로 만들고, 활성경로가 새 분기로 전환된다 (P10-T6-15)", async () => {
    const fetchMock = vi.fn(async () => ({
      body: sseBody([
        sseFrame("message_start", { messageId: "msg-1" }),
        sseFrame("text_delta", { text: "첫 응답" }),
        sseFrame("stop", { reason: "end_turn" }),
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("원본 질문");
    });

    const userMessage = result.current.messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage?.branch).toBeUndefined();

    fetchMock.mockImplementationOnce(async () => ({
      body: sseBody([
        sseFrame("message_start", { messageId: "msg-2" }),
        sseFrame("text_delta", { text: "편집된 응답" }),
        sseFrame("stop", { reason: "end_turn" }),
      ]),
    }));

    await act(async () => {
      await result.current.editMessage(userMessage!.id, "편집된 질문");
    });

    // 활성경로가 새 분기로 전환: user 메시지 2개(형제 각 1/2, 2/2)가 아니라
    // 활성경로에는 편집된 user 메시지 1개만 렌더되고, 페이저 정보를 담는다.
    const userMessages = result.current.messages.filter(
      (m) => m.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toBe("편집된 질문");
    expect(userMessages[0]?.branch).toEqual({ index: 2, count: 2 });

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.content).toBe("편집된 응답");
  });

  it("switchBranch 로 형제 분기를 전환하면 활성경로가 해당 분기의 이전에 스트리밍된 내용으로 복원된다 (P10-T6-15)", async () => {
    const fetchMock = vi.fn(async () => ({
      body: sseBody([
        sseFrame("message_start", { messageId: "msg-1" }),
        sseFrame("text_delta", { text: "첫 응답" }),
        sseFrame("stop", { reason: "end_turn" }),
      ]),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("원본 질문");
    });
    const originalUserId = result.current.messages.find(
      (m) => m.role === "user",
    )!.id;

    fetchMock.mockImplementationOnce(async () => ({
      body: sseBody([
        sseFrame("message_start", { messageId: "msg-2" }),
        sseFrame("text_delta", { text: "편집된 응답" }),
        sseFrame("stop", { reason: "end_turn" }),
      ]),
    }));
    await act(async () => {
      await result.current.editMessage(originalUserId, "편집된 질문");
    });

    const editedUserId = result.current.messages.find(
      (m) => m.role === "user",
    )!.id;

    act(() => {
      result.current.switchBranch(editedUserId, "prev");
    });

    const afterSwitch = result.current.messages;
    expect(afterSwitch.find((m) => m.role === "user")?.content).toBe(
      "원본 질문",
    );
    expect(afterSwitch.find((m) => m.role === "user")?.branch).toEqual({
      index: 1,
      count: 2,
    });
    expect(afterSwitch.find((m) => m.role === "assistant")?.content).toBe(
      "첫 응답",
    );
  });
});

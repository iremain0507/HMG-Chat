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

  it("멀티-leg: 중간 stop(reason=tool_use) 은 종단이 아니며 최종 stop(end_turn) 까지 isStreaming 을 유지하고 leg2 답변을 렌더한다", async () => {
    const enc = new TextEncoder();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        ctl = c;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ body: stream })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    let sendDone!: Promise<void>;
    await act(async () => {
      sendDone = result.current.send("조사해줘");
      // leg1: 도구 호출 후 중간 stop(reason=tool_use) — 이후 tool_result/leg2 가 이어진다.
      ctl.enqueue(
        enc.encode(
          sseFrame("message_start", {
            messageId: "m1",
            meta: { provider: "f", model: "f" },
          }),
        ),
      );
      ctl.enqueue(
        enc.encode(
          sseFrame("tool_use", {
            toolCallId: "c1",
            name: "deep_research",
            args: {},
          }),
        ),
      );
      ctl.enqueue(
        enc.encode(
          sseFrame("stop", {
            reason: "tool_use",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ),
      );
      await new Promise((r) => setTimeout(r, 0));
    });

    // 중간 stop 이후에도 스트리밍은 계속되어야 한다(종단 오인 금지).
    expect(result.current.isStreaming).toBe(true);

    await act(async () => {
      ctl.enqueue(
        enc.encode(
          sseFrame("tool_result", { toolCallId: "c1", content: "리서치 결과" }),
        ),
      );
      ctl.enqueue(
        enc.encode(
          sseFrame("message_start", {
            messageId: "m2",
            meta: { provider: "f", model: "f" },
          }),
        ),
      );
      ctl.enqueue(
        enc.encode(sseFrame("text_delta", { text: "디크팩토리는 …" })),
      );
      ctl.enqueue(
        enc.encode(
          sseFrame("stop", {
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          }),
        ),
      );
      ctl.close();
      await sendDone;
    });

    expect(result.current.isStreaming).toBe(false);
    const finalAssistant = result.current.messages
      .filter((m) => m.role === "assistant")
      .pop();
    expect(finalAssistant?.content).toContain("디크팩토리는");
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

  it("regenerate 는 같은 user 턴 아래 assistant 형제를 새로 만들고, user 턴은 중복되지 않는다 (P17-T6-03, TS-06)", async () => {
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

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage).toBeDefined();

    fetchMock.mockImplementationOnce(async () => ({
      body: sseBody([
        sseFrame("message_start", { messageId: "msg-2" }),
        sseFrame("text_delta", { text: "대안 응답" }),
        sseFrame("stop", { reason: "end_turn" }),
      ]),
    }));

    await act(async () => {
      await result.current.regenerate(assistantMessage!.id);
    });

    // 재생성은 새 user 턴을 추가하지 않는다 — user 메시지는 여전히 1개.
    const userMessages = result.current.messages.filter(
      (m) => m.role === "user",
    );
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]?.content).toBe("원본 질문");
    expect(userMessages[0]?.branch).toBeUndefined();

    // 같은 user 턴 아래 assistant 형제 2/2 가 생기고 활성경로는 새 형제로 전환된다.
    const activeAssistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(activeAssistant?.content).toBe("대안 응답");
    expect(activeAssistant?.branch).toEqual({ index: 2, count: 2 });

    // regenerate 요청도 동일 엔드포인트로 전송됨(새 세션 경로 아님).
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/session-1/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ content: "원본 질문" }),
      }),
    );
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

  // P10-T6-17 — 에러/신뢰: turn 내 원인별 에러배너 + 재시도(재시도 가능 코드만) +
  // SSE 드롭 재연결/resume.
  it("error 이벤트의 SerializedError.retryable/category 를 메시지 노드에 반영한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("error", {
            error: {
              code: "RATE_LIMITED",
              category: "rate-limit",
              message: "요청이 너무 많습니다",
              retryable: true,
            },
          }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    const errorMessage = result.current.messages.find((m) => m.error);
    expect(errorMessage?.retryable).toBe(true);
    expect(errorMessage?.errorCategory).toBe("rate-limit");
    expect(result.current.isStreaming).toBe(false);
  });

  it("retryable:false 인 error 이벤트(크레딧 부족 등)는 retryable 이 false 로 반영된다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("error", {
            error: {
              code: "QUOTA_EXCEEDED",
              category: "auth",
              message: "크레딧이 부족합니다",
              retryable: false,
            },
          }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    const errorMessage = result.current.messages.find((m) => m.error);
    expect(errorMessage?.retryable).toBe(false);
  });

  it("stop 없이 스트림이 끊기면 resume 엔드포인트(GET .../messages/:messageId/stream)로 재연결해 이어받는다", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.endsWith("/stream")) {
        return {
          ok: true,
          body: sseBody([
            sseFrame("message_replace", {
              messageId: "msg-1",
              contentSoFar: "hel",
            }),
            sseFrame("text_delta", { text: "lo" }),
            sseFrame("stop", { reason: "end_turn" }),
          ]),
        };
      }
      return {
        ok: true,
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "hel" }),
        ]),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.isStreaming).toBe(false);
    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.content).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/session-1/messages/msg-1/stream",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("재연결 요청도 실패하면 재시도 가능한(retryable:true) 오류 메시지를 추가한다", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.endsWith("/stream")) {
        throw new Error("network down");
      }
      return {
        ok: true,
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "hel" }),
        ]),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.isStreaming).toBe(false);
    const errorMessage = result.current.messages.find((m) => m.error);
    expect(errorMessage).toBeDefined();
    expect(errorMessage?.retryable).toBe(true);
  });

  describe("loadHistory (P17-T6-01, TS-08)", () => {
    it("GET /:id/messages 응답을 시간순 선형 체인으로 복원한다", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "m-1",
              sessionId: "session-1",
              role: "user",
              content: "안녕",
            },
            {
              id: "m-2",
              sessionId: "session-1",
              role: "assistant",
              content: "반갑습니다",
            },
          ],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.loadHistory();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/messages",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "안녕"],
        ["assistant", "반갑습니다"],
      ]);
      expect(result.current.historyLoading).toBe(false);
    });

    it("응답 실패 시 조용히 빈 대화로 폴백한다(fail-soft)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false })),
      );

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.loadHistory();
      });

      expect(result.current.messages).toEqual([]);
      expect(result.current.historyLoading).toBe(false);
    });

    it("이미 진행 중인 로컬 대화가 있으면 히스토리 복원으로 덮어쓰지 않는다", async () => {
      const fetchMock = vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "hello" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
        ok: true,
        json: async () => ({
          data: [
            {
              id: "m-1",
              sessionId: "session-1",
              role: "user",
              content: "이전 대화",
            },
          ],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.send("hi");
      });
      await act(async () => {
        await result.current.loadHistory();
      });

      expect(
        result.current.messages.some((m) => m.content === "이전 대화"),
      ).toBe(false);
    });
  });
});

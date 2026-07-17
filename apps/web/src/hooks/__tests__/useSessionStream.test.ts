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

  it("stop.usage 와 message_start~stop 사이 경과시간을 assistant 메시지 meta 에 보존한다 (P20-T6-06)", async () => {
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
            usage: { inputTokens: 12, outputTokens: 34 },
          }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("hello");
    });

    const assistantMessage = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    expect(assistantMessage?.meta?.model).toBe("fake-model");
    expect(assistantMessage?.meta?.provider).toBe("fake");
    expect(assistantMessage?.meta?.inputTokens).toBe(12);
    expect(assistantMessage?.meta?.outputTokens).toBe(34);
    expect(assistantMessage?.meta?.elapsedMs).toBeGreaterThanOrEqual(0);
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

  it("탭이 hidden 상태에서 턴이 완료되면 Notification 을 1회 호출한다 (P19-T6-12)", async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    const NotificationMock = vi.fn();
    (NotificationMock as unknown as { permission: string }).permission =
      "granted";
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "hello" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(NotificationMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
  });

  it("탭이 visible 상태에서는 턴이 완료돼도 Notification 을 호출하지 않는다 (P19-T6-12)", async () => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    const NotificationMock = vi.fn();
    (NotificationMock as unknown as { permission: string }).permission =
      "granted";
    vi.stubGlobal("Notification", NotificationMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "hello" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("hello");
    });

    expect(NotificationMock).not.toHaveBeenCalled();
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

    // messageId(P18-T6-01) — 라이브 스트림에서 artifact_created 가 도착한 시점의
    // assistantId 로 채워져 메시지 인라인 카드 귀속에 쓰인다.
    expect(result.current.artifacts).toEqual([
      {
        artifactId: "artifact-1",
        artifactKind: "markdown",
        filename: "report.md",
        sizeBytes: 120,
        messageId: expect.any(String),
      },
      {
        artifactId: "artifact-2",
        artifactKind: "pdf",
        filename: "report.pdf",
        sizeBytes: 4096,
        downloadUrl: "https://s3.example.com/artifact-2",
        messageId: expect.any(String),
      },
    ]);
    expect(result.current.artifacts[0]?.messageId).toEqual(
      result.current.artifacts[1]?.messageId,
    );
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

  // P20-T6-05 — 개별 메시지 삭제: DELETE /:id/messages/:mid(P20-T1-05)를 소비해
  // 대상 노드+하위 서브트리를 트리에서 낙관적 제거하고, 실패 시 롤백한다.
  // 트리 노드 키는 서버 messageId 와 무관한 local-* 라(message_start 참고) deleteMessage 는
  // 삭제 전 GET /:id/messages 로 영속된 실제 id 를 역산해 그 id 로 DELETE 를 보낸다.
  function deleteFlowFetchMock(deleteOk: boolean) {
    return vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "DELETE") {
        return { ok: deleteOk, status: deleteOk ? 204 : 404 };
      }
      if (u.endsWith("/messages") && (!init || init.method === undefined)) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "real-u-1", role: "user", parentMessageId: null },
              {
                id: "real-a-1",
                role: "assistant",
                parentMessageId: "real-u-1",
              },
            ],
          }),
        };
      }
      return {
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("text_delta", { text: "첫 응답" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      };
    });
  }

  it("deleteMessage 는 대상 assistant 메시지의 실제 id 를 역산해 DELETE 로 요청하고 트리에서 제거한다 (P20-T6-05)", async () => {
    const fetchMock = deleteFlowFetchMock(true);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("원본 질문");
    });
    const assistantId = result.current.messages.find(
      (m) => m.role === "assistant",
    )!.id;

    await act(async () => {
      await result.current.deleteMessage(assistantId);
    });

    expect(result.current.messages.some((m) => m.id === assistantId)).toBe(
      false,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/session-1/messages/real-a-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteMessage 는 대상 user 메시지를 지우면 하위 assistant 응답도 함께 트리에서 제거한다 (P20-T6-05)", async () => {
    const fetchMock = deleteFlowFetchMock(true);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("원본 질문");
    });
    const userId = result.current.messages.find((m) => m.role === "user")!.id;
    const assistantId = result.current.messages.find(
      (m) => m.role === "assistant",
    )!.id;

    await act(async () => {
      await result.current.deleteMessage(userId);
    });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.messages.some((m) => m.id === assistantId)).toBe(
      false,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/sessions/session-1/messages/real-u-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("deleteMessage 는 서버 요청이 실패하면 낙관적 제거를 롤백한다 (P20-T6-05)", async () => {
    const fetchMock = deleteFlowFetchMock(false);
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));

    await act(async () => {
      await result.current.send("원본 질문");
    });
    const assistantId = result.current.messages.find(
      (m) => m.role === "assistant",
    )!.id;

    await act(async () => {
      await result.current.deleteMessage(assistantId);
    });

    expect(result.current.messages.some((m) => m.id === assistantId)).toBe(
      true,
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
    // P17-T6-08(TS-24) — ChatView 가 오프라인→온라인 복귀 시 이 카테고리만 골라
    // 자동 재연결하므로, rate-limit 등 다른 재시도 가능 오류와 구분돼야 한다.
    expect(errorMessage?.errorCategory).toBe("network");
  });

  // iOS 등 백그라운드 서스펜션 후 foreground 복귀 — 진행 중 turn 이 드롭됐다가 resume 될 때
  // (a) 이미 렌더된 도구 카드가 유지되고 (b) 백그라운드 중 턴이 끝났으면 최종 답변을 복구한다.
  it("resume 의 message_replace 는 이미 렌더된 도구 카드(tool 파트)를 파괴하지 않는다 (iOS 백그라운드 복귀)", async () => {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.endsWith("/stream")) {
        return {
          ok: true,
          body: sseBody([
            sseFrame("message_replace", {
              messageId: "msg-1",
              contentSoFar: "부분",
            }),
            sseFrame("text_delta", { text: "완성" }),
            sseFrame("stop", { reason: "end_turn" }),
          ]),
        };
      }
      // 최초 POST leg: 도구 호출 카드 + 부분 텍스트까지 스트리밍 후 (종단 없이) 드롭.
      return {
        ok: true,
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("tool_use", {
            toolCallId: "t1",
            name: "deep_research",
            args: {},
          }),
          sseFrame("text_delta", { text: "부분" }),
        ]),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    // 과거엔 message_replace 가 parts 를 텍스트 전용으로 덮어써 도구 카드가 사라졌다.
    expect(
      assistant?.parts?.some((p) => p.type === "tool" && p.toolCallId === "t1"),
    ).toBe(true);
    expect(assistant?.content).toBe("부분완성");
  });

  it("백그라운드 중 턴이 끝나 resume 이 410(gone)을 주면 최종 답변을 복구하고 '연결 끊김' 오류를 띄우지 않는다", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: unknown) => {
      if (typeof url === "string" && url.endsWith("/stream")) {
        // 서버 턴이 이미 종료됨 → 410 gone.
        return { ok: false, status: 410 };
      }
      if (
        typeof url === "string" &&
        url.endsWith("/messages") &&
        (init as { method?: string } | undefined)?.method === "POST"
      ) {
        // 최초 POST leg: 부분 텍스트까지 스트리밍 후 (종단 없이) 드롭.
        return {
          ok: true,
          body: sseBody([
            sseFrame("message_start", { messageId: "msg-1" }),
            sseFrame("text_delta", { text: "부분 답변" }),
          ]),
        };
      }
      // GET /:id/messages — 영속된 최종 답변(POST finally 의 assistant insert).
      return {
        ok: true,
        json: async () => ({
          data: [
            { id: "u1", role: "user", content: "hi" },
            {
              id: "a1",
              role: "assistant",
              content: "부분 답변 그리고 끝까지 완성된 최종 답변",
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("hi");
    });

    // 과거엔 410 을 res.ok===false 로 보고 "연결이 끊어졌습니다" 오류를 띄웠다.
    expect(result.current.messages.some((m) => m.error)).toBe(false);
    const assistant = result.current.messages.find(
      (m) => m.role === "assistant" && !m.error,
    );
    expect(assistant?.content).toBe("부분 답변 그리고 끝까지 완성된 최종 답변");
  });

  it("reasoning_delta 이벤트를 message.reasoning 에 누적하고 최종 답변(content)과 분리한다 (P20-T2-03)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        body: sseBody([
          sseFrame("message_start", { messageId: "msg-1" }),
          sseFrame("reasoning_delta", { text: "먼저 " }),
          sseFrame("reasoning_delta", { text: "생각해본다." }),
          sseFrame("text_delta", { text: "최종답변" }),
          sseFrame("stop", { reason: "end_turn" }),
        ]),
      })),
    );

    const { result } = renderHook(() => useSessionStream("session-1"));
    await act(async () => {
      await result.current.send("추론해줘", undefined, {
        reasoningEffort: "high",
      });
    });

    const assistant = result.current.messages.find(
      (m) => m.role === "assistant",
    );
    // 사고 스트림은 reasoning 에 누적(과거엔 reasoning 이벤트 자체가 없어 미표시).
    expect(assistant?.reasoning).toBe("먼저 생각해본다.");
    // 최종 답변은 content 로 분리 유지(사고가 답변에 섞이지 않음).
    expect(assistant?.content).toBe("최종답변");
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

    it("parentMessageId 로 형제 분기를 복원하고 switchBranch 로 prev/next 전환된다 (P19-T6-01)", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "m-1",
              sessionId: "session-1",
              role: "user",
              content: "안녕",
              parentMessageId: null,
            },
            {
              id: "m-2",
              sessionId: "session-1",
              role: "assistant",
              content: "첫번째 답변",
              parentMessageId: "m-1",
            },
            {
              id: "m-3",
              sessionId: "session-1",
              role: "assistant",
              content: "재생성된 답변",
              parentMessageId: "m-1",
            },
          ],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.loadHistory();
      });

      // 가장 최근 형제(m-3, 재생성된 답변)가 활성 경로로 복원된다.
      expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
        ["user", "안녕"],
        ["assistant", "재생성된 답변"],
      ]);
      const activeAssistant = result.current.messages.find(
        (m) => m.role === "assistant",
      );
      expect(activeAssistant?.branch).toEqual({ index: 2, count: 2 });

      act(() => {
        result.current.switchBranch("m-3", "prev");
      });

      const afterSwitch = result.current.messages;
      expect(afterSwitch.map((m) => [m.role, m.content])).toEqual([
        ["user", "안녕"],
        ["assistant", "첫번째 답변"],
      ]);
      expect(afterSwitch.find((m) => m.role === "assistant")?.branch).toEqual({
        index: 1,
        count: 2,
      });
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

  describe("loadArtifacts (P18-T6-02)", () => {
    it("GET /:id/artifacts 응답으로 artifacts 상태를 복원한다", async () => {
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "artifact-1",
              sessionId: "session-1",
              type: "markdown",
              filename: "report.md",
              sizeBytes: 120,
              storageKind: "inline",
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          ],
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.loadArtifacts();
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-1/artifacts",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(result.current.artifacts).toEqual([
        {
          artifactId: "artifact-1",
          artifactKind: "markdown",
          filename: "report.md",
          sizeBytes: 120,
          restored: true,
        },
      ]);
    });

    it("응답 실패 시 조용히 빈 목록으로 폴백한다(fail-soft)", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({ ok: false })),
      );

      const { result } = renderHook(() => useSessionStream("session-1"));
      await act(async () => {
        await result.current.loadArtifacts();
      });

      expect(result.current.artifacts).toEqual([]);
    });
  });

  describe("세션 전환 시 상태 리셋 + 스트림 abort (P21-T6-04, UX-16)", () => {
    it("sessionId 변경 시 이전 세션 메시지를 즉시 비우고, 새 세션 히스토리를 다시 불러온다", async () => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/v1/sessions/session-1/messages") {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: "m-1", role: "user", content: "세션1 메시지" }],
            }),
          };
        }
        if (url === "/api/v1/sessions/session-2/messages") {
          return {
            ok: true,
            json: async () => ({
              data: [{ id: "m-2", role: "user", content: "세션2 메시지" }],
            }),
          };
        }
        throw new Error(`unexpected url ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result, rerender } = renderHook(
        ({ sessionId }) => useSessionStream(sessionId),
        { initialProps: { sessionId: "session-1" } },
      );

      await act(async () => {
        await result.current.loadHistory();
      });
      expect(result.current.messages.map((m) => m.content)).toEqual([
        "세션1 메시지",
      ]);

      rerender({ sessionId: "session-2" });

      // 세션 전환 즉시 이전 세션(A) 메시지는 화면에서 사라져야 한다 — 현재는
      // historyLoadedRef/treeRef 가 리셋되지 않아 A 메시지가 그대로 남는다(RED).
      expect(result.current.messages).toEqual([]);

      await act(async () => {
        await result.current.loadHistory();
      });
      // historyLoadedRef 가 리셋되지 않으면 이 두번째 loadHistory 는 조용히 early-return
      // 하고 새 세션의 히스토리를 fetch 하지 않는다(RED).
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/sessions/session-2/messages",
        expect.objectContaining({ credentials: "include" }),
      );
      expect(result.current.messages.map((m) => m.content)).toEqual([
        "세션2 메시지",
      ]);
    });

    it("세션 전환 시 진행 중이던 이전 세션의 스트림을 abort 한다", () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return { body: new ReadableStream<Uint8Array>({ start() {} }) };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result, rerender } = renderHook(
        ({ sessionId }) => useSessionStream(sessionId),
        { initialProps: { sessionId: "session-1" } },
      );

      act(() => {
        void result.current.send("hello");
      });
      expect(capturedSignal?.aborted).toBe(false);

      rerender({ sessionId: "session-2" });

      expect(capturedSignal?.aborted).toBe(true);
    });

    it("컴포넌트 언마운트 시 진행 중이던 스트림을 abort 한다", () => {
      let capturedSignal: AbortSignal | undefined;
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        capturedSignal = init?.signal ?? undefined;
        return { body: new ReadableStream<Uint8Array>({ start() {} }) };
      });
      vi.stubGlobal("fetch", fetchMock);

      const { result, unmount } = renderHook(() =>
        useSessionStream("session-1"),
      );

      act(() => {
        void result.current.send("hello");
      });
      expect(capturedSignal?.aborted).toBe(false);

      unmount();

      expect(capturedSignal?.aborted).toBe(true);
    });
  });
});

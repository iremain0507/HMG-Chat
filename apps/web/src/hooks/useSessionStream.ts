"use client";

// hooks/useSessionStream.ts — 16-API-CONTRACT § POST /sessions/:id/messages (SSE) +
// DELETE /sessions/:id/active-run 소비. 18-FRONTEND-WIREFRAMES § 18.6.3 stream 처리
// reducer 를 Phase 2 서버 구현 범위(message_start/text_delta/stop/error)로 좁혀 구현 —
// tool_use/hitl_*/citation/artifact_created/message_replace 는 Phase 3/4 이후 확장.
import { useCallback, useRef, useState } from "react";

export type ToolCallStatus = "queued" | "running" | "done" | "error";

export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      args: unknown;
      status: ToolCallStatus;
      result?: string | unknown;
    };

export interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];
  truncated?: boolean;
  error?: boolean;
  citations?: Citation[];
}

// 14-INTERFACES § ChatEvent.citation 과 1:1 (type 필드 제외).
export interface Citation {
  index: number;
  source: "project" | "ephemeral";
  documentId?: string;
  uploadId?: string;
  filename: string;
  title?: string;
  page?: number;
  sourceUri?: string;
  snippet: string;
}

// 14-INTERFACES § ChatEvent.hitl_request 와 1:1 (toolCallId/toolName/args/rationale/expiresAt).
export interface HitlPromptData {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  expiresAt: string;
}

type ChatStreamEvent =
  | {
      type: "message_start";
      messageId: string;
      meta?: { provider: string; model: string };
    }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown }
  | {
      type: "hitl_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      rationale: string;
      expiresAt: string;
    }
  | {
      type: "hitl_resolved";
      toolCallId: string;
      decision: "approved" | "denied";
      modifiedArgs?: Record<string, unknown>;
      reason?: string;
    }
  | { type: "hitl_timeout"; toolCallId: string }
  | ({ type: "citation" } & Citation)
  | {
      type: "stop";
      reason: "end_turn" | "tool_use" | "max_tokens" | "aborted";
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; error: { code: string; message: string } };

// AgentToolResult.content(kind:"error") 는 orchestrator 가 { error: WChatError } 로
// 감싸 emit(orchestrator.ts toToolResultContent) — 그 shape 을 client 에서 재검출.
function isErrorToolResult(content: unknown): boolean {
  return typeof content === "object" && content !== null && "error" in content;
}

function parseSseFrame(frame: string): ChatStreamEvent | null {
  let eventName: string | null = null;
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice("data:".length).trim();
    }
  }
  if (!eventName || !data) return null;
  try {
    return { type: eventName, ...JSON.parse(data) } as ChatStreamEvent;
  } catch {
    return null;
  }
}

export function useSessionStream(sessionId: string) {
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hitlRequest, setHitlRequest] = useState<HitlPromptData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (content: string) => {
      setMessages((prev) => [
        ...prev,
        { id: `local-${prev.length}-${content}`, role: "user", content },
      ]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantId: string | null = null;

      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/messages`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({ content }),
        });

        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIndex = buffer.indexOf("\n\n");
          while (sepIndex !== -1) {
            const frame = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            const event = parseSseFrame(frame);
            sepIndex = buffer.indexOf("\n\n");
            if (!event) continue;

            if (event.type === "message_start") {
              assistantId = event.messageId;
              const id = assistantId;
              setMessages((prev) => [
                ...prev,
                { id, role: "assistant", content: "" },
              ]);
            } else if (event.type === "text_delta" && assistantId) {
              const id = assistantId;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== id) return m;
                  const parts = m.parts ?? [];
                  const last = parts.at(-1);
                  const nextParts: MessagePart[] =
                    last?.type === "text"
                      ? [
                          ...parts.slice(0, -1),
                          { type: "text", text: last.text + event.text },
                        ]
                      : [...parts, { type: "text", text: event.text }];
                  return {
                    ...m,
                    content: m.content + event.text,
                    parts: nextParts,
                  };
                }),
              );
            } else if (event.type === "tool_use" && assistantId) {
              const id = assistantId;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === id
                    ? {
                        ...m,
                        parts: [
                          ...(m.parts ?? []),
                          {
                            type: "tool",
                            toolCallId: event.toolCallId,
                            name: event.name,
                            args: event.args,
                            status: "running",
                          },
                        ],
                      }
                    : m,
                ),
              );
            } else if (event.type === "tool_result" && assistantId) {
              const id = assistantId;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === id && m.parts
                    ? {
                        ...m,
                        parts: m.parts.map((p) =>
                          p.type === "tool" && p.toolCallId === event.toolCallId
                            ? {
                                ...p,
                                status: isErrorToolResult(event.content)
                                  ? "error"
                                  : "done",
                                result: event.content,
                              }
                            : p,
                        ),
                      }
                    : m,
                ),
              );
            } else if (event.type === "citation" && assistantId) {
              const id = assistantId;
              const citation: Citation = {
                index: event.index,
                source: event.source,
                filename: event.filename,
                snippet: event.snippet,
                ...(event.documentId !== undefined
                  ? { documentId: event.documentId }
                  : {}),
                ...(event.uploadId !== undefined
                  ? { uploadId: event.uploadId }
                  : {}),
                ...(event.title !== undefined ? { title: event.title } : {}),
                ...(event.page !== undefined ? { page: event.page } : {}),
                ...(event.sourceUri !== undefined
                  ? { sourceUri: event.sourceUri }
                  : {}),
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === id
                    ? { ...m, citations: [...(m.citations ?? []), citation] }
                    : m,
                ),
              );
            } else if (event.type === "hitl_request") {
              setHitlRequest({
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                rationale: event.rationale,
                expiresAt: event.expiresAt,
              });
            } else if (
              event.type === "hitl_resolved" ||
              event.type === "hitl_timeout"
            ) {
              setHitlRequest((prev) =>
                prev && prev.toolCallId === event.toolCallId ? null : prev,
              );
            } else if (event.type === "stop") {
              setIsStreaming(false);
            } else if (event.type === "error") {
              const message = event.error?.message ?? "알 수 없는 오류";
              setMessages((prev) => [
                ...prev,
                {
                  id: `err-${prev.length}`,
                  role: "assistant",
                  content: message,
                  error: true,
                },
              ]);
              setIsStreaming(false);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setIsStreaming(false);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId],
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (!last || last.role !== "assistant") return prev;
      const updated = prev.slice();
      updated[updated.length - 1] = {
        ...last,
        content: `${last.content}\n\n[잘림]`,
        truncated: true,
      };
      return updated;
    });
    await fetch(`/api/v1/sessions/${sessionId}/active-run`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {});
  }, [sessionId]);

  const respondHitl = useCallback(
    async (
      decision: "approved" | "denied",
      modifiedArgs?: Record<string, unknown>,
      reason?: string,
    ) => {
      if (!hitlRequest) return;
      await fetch(`/api/v1/sessions/${sessionId}/messages/hitl`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId: hitlRequest.toolCallId,
          decision,
          ...(modifiedArgs ? { modifiedArgs } : {}),
          ...(reason ? { reason } : {}),
        }),
      }).catch(() => {});
    },
    [sessionId, hitlRequest],
  );

  return { messages, isStreaming, send, stop, hitlRequest, respondHitl };
}

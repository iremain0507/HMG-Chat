"use client";

// hooks/useSessionStream.ts — 16-API-CONTRACT § POST /sessions/:id/messages (SSE) +
// DELETE /sessions/:id/active-run 소비. 18-FRONTEND-WIREFRAMES § 18.6.3 stream 처리
// reducer 를 Phase 2 서버 구현 범위(message_start/text_delta/stop/error)로 좁혀 구현 —
// tool_use/hitl_*/citation/artifact_created/message_replace 는 Phase 3/4 이후 확장.
import { useCallback, useRef, useState } from "react";

export interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  truncated?: boolean;
}

type ChatStreamEvent =
  | {
      type: "message_start";
      messageId: string;
      meta?: { provider: string; model: string };
    }
  | { type: "text_delta"; text: string }
  | {
      type: "stop";
      reason: "end_turn" | "tool_use" | "max_tokens" | "aborted";
      usage?: { inputTokens: number; outputTokens: number };
    }
  | { type: "error"; error: { code: string; message: string } };

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
                prev.map((m) =>
                  m.id === id ? { ...m, content: m.content + event.text } : m,
                ),
              );
            } else if (event.type === "stop" || event.type === "error") {
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

  return { messages, isStreaming, send, stop };
}

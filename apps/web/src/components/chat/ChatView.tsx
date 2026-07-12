"use client";

// components/chat/ChatView.tsx — 18-FRONTEND-WIREFRAMES § 18.5.1 /chat/[sessionId] 의
// Phase 2 범위 최소 구현: 메시지 리스트 + 입력 + SSE 스트리밍 표시 + Stop 버튼.
// 사이드바/artifact panel/HITL/tool-call/citation 렌더는 이후 phase 범위(08-SPRINT-PLAN 참조).
import React, { useState, type FormEvent } from "react";
import { useSessionStream } from "../../hooks/useSessionStream";

export function ChatView({ sessionId }: { sessionId: string }) {
  const { messages, isStreaming, send, stop } = useSessionStream(sessionId);
  const [input, setInput] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setInput("");
    await send(content);
  }

  return (
    <div>
      <ul aria-label="메시지 목록">
        {messages.map((m) => (
          <li key={m.id} data-role={m.role}>
            {m.content}
          </li>
        ))}
      </ul>
      <form onSubmit={handleSubmit}>
        <label htmlFor="chat-input">메시지 입력</label>
        <textarea
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button type="submit" disabled={isStreaming}>
          전송
        </button>
        {isStreaming && (
          <button type="button" onClick={() => stop()}>
            Stop
          </button>
        )}
      </form>
    </div>
  );
}

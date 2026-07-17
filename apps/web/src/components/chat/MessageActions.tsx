"use client";

// components/chat/MessageActions.tsx — P10-T6-03 hover 액션바.
// 복사(마크다운 원문) / 재생성(assistant 전용) / 👍👎 피드백.
// P19-T6-07: sessionId/messageId 가 주어지면 피드백이 서버(P19-T1-07)에 영속된다
// (낙관적 업데이트 후 서버 응답으로 확정, 실패 시 롤백). 둘 다 없으면(예: 기존 테스트)
// 로컬 표시 전용으로 남는다.
import React, { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { sendMessageFeedback } from "../../lib/messageFeedback";

export function MessageActions({
  role,
  content,
  sessionId,
  messageId,
  onRegenerate,
  onEdit,
}: {
  role: "user" | "assistant";
  content: string;
  sessionId?: string;
  messageId?: string;
  onRegenerate?: () => void;
  onEdit?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);

  async function copy() {
    if (!(await copyText(content))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function toggleFeedback(next: "up" | "down") {
    const previous = feedback;
    const nextState = previous === next ? null : next;
    setFeedback(nextState);
    if (!sessionId || !messageId) return;
    const rating = next === "up" ? 1 : -1;
    const saved = await sendMessageFeedback(sessionId, messageId, rating);
    if (saved === undefined) {
      setFeedback(previous);
      return;
    }
    setFeedback(saved === 1 ? "up" : saved === -1 ? "down" : null);
  }

  return (
    <div className="flex items-center gap-1 text-fg-muted">
      <button
        type="button"
        aria-label="복사"
        onClick={() => void copy()}
        className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
      >
        {copied ? "복사됨" : "복사"}
      </button>
      {role === "user" && onEdit && (
        <button
          type="button"
          aria-label="편집"
          onClick={onEdit}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
        >
          편집
        </button>
      )}
      {role === "assistant" && onRegenerate && (
        <button
          type="button"
          aria-label="재생성"
          onClick={onRegenerate}
          className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg"
        >
          재생성
        </button>
      )}
      {role === "assistant" && (
        <>
          <button
            type="button"
            aria-label="좋아요"
            aria-pressed={feedback === "up"}
            onClick={() => void toggleFeedback("up")}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-primary"
          >
            👍
          </button>
          <button
            type="button"
            aria-label="싫어요"
            aria-pressed={feedback === "down"}
            onClick={() => void toggleFeedback("down")}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-accent"
          >
            👎
          </button>
        </>
      )}
    </div>
  );
}

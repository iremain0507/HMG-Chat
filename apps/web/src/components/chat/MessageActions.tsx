"use client";

// components/chat/MessageActions.tsx — P10-T6-03 hover 액션바.
// 복사(마크다운 원문) / 재생성(assistant 전용) / 👍👎 피드백(로컬 상태, 백엔드 계약 없음).
import React, { useState } from "react";
import { copyText } from "../../lib/clipboard";

export function MessageActions({
  role,
  content,
  onRegenerate,
  onEdit,
}: {
  role: "user" | "assistant";
  content: string;
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
            onClick={() => setFeedback((f) => (f === "up" ? null : "up"))}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-primary"
          >
            👍
          </button>
          <button
            type="button"
            aria-label="싫어요"
            aria-pressed={feedback === "down"}
            onClick={() => setFeedback((f) => (f === "down" ? null : "down"))}
            className="rounded-md p-1 text-xs hover:bg-surface hover:text-fg aria-pressed:text-accent"
          >
            👎
          </button>
        </>
      )}
    </div>
  );
}

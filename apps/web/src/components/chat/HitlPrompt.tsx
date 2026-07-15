"use client";

// components/chat/HitlPrompt.tsx — HITL 승인 카드 (z-hitl, aria-live=assertive).
//   평문 액션 설명 + 인자 인라인 편집 + 거부/수정/승인 → 호출부가 POST /messages/hitl 로 전송.
import React, { useState } from "react";
import type { HitlPromptData } from "../../hooks/useSessionStream";

export function HitlPrompt({
  request,
  onRespond,
}: {
  request: HitlPromptData;
  onRespond: (
    decision: "approved" | "denied",
    modifiedArgs?: Record<string, unknown>,
    reason?: string,
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [argsText, setArgsText] = useState(() =>
    JSON.stringify(request.args, null, 2),
  );
  const [argsError, setArgsError] = useState<string | null>(null);

  function approve() {
    if (!editing) {
      onRespond("approved", undefined, undefined);
      return;
    }
    try {
      const modifiedArgs = JSON.parse(argsText) as Record<string, unknown>;
      setArgsError(null);
      onRespond("approved", modifiedArgs, undefined);
    } catch {
      setArgsError("인자 JSON 형식이 올바르지 않습니다.");
    }
  }

  function deny() {
    onRespond("denied", undefined, undefined);
  }

  return (
    <div
      data-testid="hitl-prompt"
      role="alertdialog"
      aria-live="assertive"
      aria-label="승인 요청"
      className="relative z-[var(--z-hitl)] mx-auto mb-3 max-w-3xl rounded-2xl border border-accent/40 bg-surface p-4 shadow-lg"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
        승인 필요
      </p>
      <p className="mt-1 text-sm text-fg">{request.rationale}</p>
      <p className="mt-1 text-xs text-fg-muted">{request.toolName}</p>

      {editing ? (
        <div className="mt-3">
          <textarea
            aria-label="인자 편집"
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border bg-bg p-2 font-mono text-xs text-fg outline-none"
          />
          {argsError && <p className="mt-1 text-xs text-accent">{argsError}</p>}
        </div>
      ) : (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-bg p-2 text-xs text-fg-muted">
          {JSON.stringify(request.args, null, 2)}
        </pre>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={deny}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-accent hover:text-accent"
        >
          거부
        </button>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
        >
          {editing ? "수정 취소" : "수정"}
        </button>
        <button
          type="button"
          onClick={approve}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-fg"
        >
          승인
        </button>
      </div>
    </div>
  );
}

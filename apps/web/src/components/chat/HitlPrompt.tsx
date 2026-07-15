"use client";

// components/chat/HitlPrompt.tsx — HITL 승인 카드 (design-reference F06 핸드오프).
//   z-hitl(300) 딤 모달: 경고 아이콘+제목+평문 요약(도구명·비가역 고지)+JSON 인라인 편집+
//   카운트다운(mono)+[거부/수정 후 승인/승인] → 호출부가 POST /messages/hitl 로 전송.
import React, { useEffect, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import type { HitlPromptData } from "../../hooks/useSessionStream";

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.round(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useCountdown(expiresAt: string): number {
  const [remainingMs, setRemainingMs] = useState(
    () => new Date(expiresAt).getTime() - Date.now(),
  );
  useEffect(() => {
    const tick = () =>
      setRemainingMs(new Date(expiresAt).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return Math.max(0, remainingMs);
}

const FOOTER_BUTTON =
  "rounded-md px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

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
  const remainingMs = useCountdown(request.expiresAt);

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

  function cancelEdit() {
    setArgsText(JSON.stringify(request.args, null, 2));
    setArgsError(null);
    setEditing(false);
  }

  return (
    <div className="fixed inset-0 z-[var(--z-hitl)] flex items-center justify-center bg-fg/40 px-4">
      <div
        data-testid="hitl-prompt"
        role="alertdialog"
        aria-modal="true"
        aria-live="assertive"
        aria-label="승인 요청"
        className="w-full max-w-md rounded-[14px] border border-warning bg-bg p-5 shadow-lg"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 flex-none place-items-center rounded-full bg-warning-soft"
          >
            <AlertTriangle
              size={17}
              strokeWidth={2}
              className="text-warning-fg"
            />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-fg">
              도구 실행 승인이 필요합니다
            </p>
            <p className="mt-1 text-sm leading-relaxed text-fg">
              {request.rationale}
            </p>
            <p className="mt-1 font-mono text-xs text-fg-muted">
              {request.toolName}
            </p>
          </div>
        </div>

        {editing ? (
          <div className="mt-3">
            <textarea
              aria-label="인자 편집"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-primary-400 bg-surface p-2.5 font-mono text-xs text-fg outline-none"
            />
            {argsError && (
              <p className="mt-1 text-xs text-accent">{argsError}</p>
            )}
          </div>
        ) : (
          <pre className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-surface p-2.5 font-mono text-xs text-fg-muted">
            {JSON.stringify(request.args, null, 2)}
          </pre>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Clock
            size={13}
            strokeWidth={2}
            className="text-warning-fg"
            aria-hidden="true"
          />
          <span
            data-testid="hitl-countdown"
            className="font-mono text-xs tabular-nums text-warning-fg"
          >
            {formatCountdown(remainingMs)} 후 자동 거부
          </span>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          {editing ? (
            <button
              type="button"
              onClick={cancelEdit}
              className={`${FOOTER_BUTTON} text-fg-muted hover:text-fg`}
            >
              취소
            </button>
          ) : (
            <button
              type="button"
              onClick={deny}
              className={`${FOOTER_BUTTON} text-fg-muted hover:text-fg`}
            >
              거부
            </button>
          )}
          <button
            type="button"
            onClick={() => (editing ? approve() : setEditing(true))}
            className={`${FOOTER_BUTTON} border border-border hover:border-primary`}
          >
            수정 후 승인
          </button>
          {!editing && (
            <button
              type="button"
              onClick={approve}
              className={`${FOOTER_BUTTON} bg-primary text-primary-fg`}
            >
              승인
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

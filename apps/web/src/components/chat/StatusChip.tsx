"use client";

// components/chat/StatusChip.tsx — queued/running/done/error 공용 상태 어휘 칩.
// ToolCallRenderer 및 후속 HITL 카드(P10-T6-08)가 공유하는 표준 상태 표기.
import React from "react";
import type { ToolCallStatus } from "../../hooks/useSessionStream";

const LABELS: Record<ToolCallStatus, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
};

const STYLES: Record<ToolCallStatus, string> = {
  queued: "border-border bg-surface text-fg-muted",
  running: "border-primary/30 bg-primary/10 text-primary",
  done: "border-primary/20 bg-primary/10 text-primary",
  error: "border-accent/30 bg-accent/10 text-accent",
};

export function StatusChip({ status }: { status: ToolCallStatus }) {
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
    >
      {status === "running" && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
        />
      )}
      {LABELS[status]}
    </span>
  );
}

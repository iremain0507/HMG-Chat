"use client";

// components/chat/StatusChip.tsx — design-reference §6 StatusChip 5종(대기/실행 중/완료/
// 오류/승인 필요) 공용 상태 어휘 칩. 전 화면(ToolCallCard/워커 카드/HITL 카드)이 이 컴포넌트로
// 통일 표기한다(P13-T6-06). 색 매핑: running=primary 펄스, done=success, error=danger,
// pending-approval=warning, queued=neutral. 높이 22px·radius full·좌측 6px 도트,
// running 도트만 펄스(1.2s, prefers-reduced-motion 시 정지 — motion-safe 변형).
import React from "react";
import type { ToolCallStatus } from "../../hooks/useSessionStream";

export type StatusChipStatus = ToolCallStatus | "pending-approval";

const LABELS: Record<StatusChipStatus, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
  "pending-approval": "승인 필요",
};

const STYLES: Record<StatusChipStatus, string> = {
  queued: "border-border bg-surface text-fg-muted",
  running: "border-primary/30 bg-primary/10 text-primary",
  done: "border-success/30 bg-success-soft text-success",
  error: "border-accent/30 bg-accent/10 text-accent",
  "pending-approval": "border-warning bg-warning-soft text-warning-fg",
};

const DOT_STYLES: Record<StatusChipStatus, string> = {
  queued: "bg-fg-subtle",
  running: "bg-primary motion-safe:animate-[pulse_1.2s_ease-in-out_infinite]",
  done: "bg-success",
  error: "bg-accent",
  "pending-approval": "bg-warning",
};

export function StatusChip({ status }: { status: StatusChipStatus }) {
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-xs font-medium ${STYLES[status]}`}
    >
      <span
        data-testid="status-chip-dot"
        aria-hidden="true"
        className={`h-1.5 w-1.5 flex-none rounded-full ${DOT_STYLES[status]}`}
      />
      {LABELS[status]}
    </span>
  );
}

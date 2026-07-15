"use client";

// components/chat/RunRail.tsx — design-reference §「시그니처 요소 — 실행 레일(Run Rail)」·F04.
// 에이전틱 턴(도구를 쓴 assistant 응답) 좌측 2px 수직 레일 + 이벤트 눈금. 눈금 hover=이벤트명
// 툴팁, 클릭=onStepClick(향후 우패널 '활동' 탭 연동은 P13-T6-07/08 소관 — 이 컴포넌트는
// 순수 표시+콜백만 담당).
import React from "react";

export type RunRailStepStatus =
  "queued" | "running" | "done" | "error" | "pending-approval";

export interface RunRailStep {
  id: string;
  label: string;
  status: RunRailStepStatus;
}

const TICK_STYLES: Record<RunRailStepStatus, string> = {
  queued: "bg-fg-subtle",
  running: "bg-primary motion-safe:animate-[pulse_1.2s_ease-in-out_infinite]",
  done: "bg-success",
  error: "bg-danger",
  "pending-approval": "bg-warning",
};

const STATUS_LABEL: Record<RunRailStepStatus, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
  "pending-approval": "승인 필요",
};

export function RunRail({
  steps,
  onStepClick,
}: {
  steps: RunRailStep[];
  onStepClick?: (id: string) => void;
}) {
  if (steps.length === 0) return null;

  const lastActiveIndex = steps.reduce(
    (acc, step, idx) => (step.status === "queued" ? acc : idx),
    -1,
  );
  const fillPercent =
    lastActiveIndex < 0 ? 0 : ((lastActiveIndex + 1) / steps.length) * 100;

  return (
    <div data-testid="run-rail" className="relative w-2 flex-none self-stretch">
      <div
        aria-hidden="true"
        className="absolute left-[3px] top-1 bottom-0 w-0.5 rounded-full bg-border"
      />
      <div
        data-testid="run-rail-fill"
        aria-hidden="true"
        className="absolute left-[3px] top-1 w-0.5 rounded-full bg-primary transition-[height]"
        style={{ height: `${fillPercent}%` }}
      />
      {steps.map((step, idx) => {
        const top =
          steps.length === 1 ? 4 : 4 + (idx / (steps.length - 1)) * 92;
        return (
          <button
            key={step.id}
            type="button"
            data-testid={`run-rail-tick-${step.id}`}
            data-status={step.status}
            aria-label={`${step.label} — ${STATUS_LABEL[step.status]}`}
            onClick={() => onStepClick?.(step.id)}
            className="group absolute -left-1 flex h-3 w-3 -translate-y-1/2 items-center justify-center rounded-full border-0 bg-transparent p-0"
            style={{ top: `${top}%` }}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${TICK_STYLES[step.status]}`}
            />
            <span
              role="tooltip"
              data-testid={`run-rail-tooltip-${step.id}`}
              className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-[6px] bg-fg px-2 py-1 text-[10.5px] font-medium text-bg opacity-0 shadow-md transition-opacity group-hover:opacity-100"
            >
              {step.label} — {STATUS_LABEL[step.status]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

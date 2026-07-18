"use client";

// components/chat/ActivityPanel.tsx — design-reference F07(우패널 '활동' 탭 — 멀티에이전트).
//   계획 요약 배너 + 워커 카드(StatusChip + mono 출처 N) + 스텝 트레이스(계획→병렬 검색→종합)
//   + 하단 고정 [실행 중지]. 데이터는 14-INTERFACES § ToolProgress/ToolProgressTask 그대로
//   (프레임의 "검색 N"은 서버가 emit 하지 않는 필드라 미포함 — sourceCount 만 표시).
//   탭 전환·아티팩트/출처 탭과의 3-tab shell 배선은 P13-T6-08 소관, 이 컴포넌트는 '활동' 탭의
//   콘텐츠(WorkerCard 는 ToolCallRenderer 의 펼침 진행목록과 공유)만 담당.
import React, { useState } from "react";
import type {
  ToolProgressState,
  ToolTask,
  Citation,
} from "../../hooks/useSessionStream";
import { StatusChip } from "./StatusChip";

const STEP_ORDER = ["planning", "researching", "synthesizing"] as const;
type Step = (typeof STEP_ORDER)[number];
const STEP_LABELS: Record<Step, string> = {
  planning: "계획 수립",
  researching: "병렬 검색",
  synthesizing: "종합",
};
type StepStatus = "done" | "running" | "pending";

export function WorkerCard({
  task,
  index,
  citations,
}: {
  task: ToolTask;
  index: number;
  // 하위질문별 출처(완료 후 결과에서 전달). 있으면 "출처 N" 을 눌러 실제 출처 목록을 펼친다.
  citations?: Citation[] | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const sources = citations ?? [];
  const hasSources = sources.length > 0;
  const count = hasSources ? sources.length : (task.sourceCount ?? 0);
  return (
    <div
      data-testid={`activity-worker-${task.id}`}
      className={`rounded-[10px] border bg-surface px-[13px] py-[11px] ${
        task.status === "running" ? "border-primary/30" : "border-border"
      } ${task.status === "queued" ? "opacity-75" : ""}`}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex-none font-mono text-[11px] text-fg-subtle"
        >
          {index + 1}.
        </span>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-fg">
          {task.title}
        </span>
        <StatusChip status={task.status} />
      </div>
      {hasSources ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          data-testid={`worker-sources-toggle-${task.id}`}
          className="mt-1 flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-fg-muted hover:text-fg"
        >
          출처 {count}
          <span aria-hidden="true">{expanded ? "▲" : "▼"}</span>
        </button>
      ) : (
        <div className="mt-1 font-mono text-[10.5px] tabular-nums text-fg-muted">
          출처 {count}
        </div>
      )}
      {hasSources && expanded && (
        <ul className="mt-1.5 space-y-1 border-t border-border pt-1.5">
          {sources.map((c, i) => (
            <li
              key={`sub-src-${i}-${c.index}`}
              className="flex items-baseline gap-1.5 text-[11px] leading-snug"
            >
              <span className="flex-none font-semibold tabular-nums text-primary">
                [{c.index}]
              </span>
              <span className="min-w-0">
                {c.sourceUri ? (
                  <a
                    href={c.sourceUri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-fg underline decoration-border underline-offset-2 hover:decoration-primary"
                  >
                    {c.title ?? c.filename}
                  </a>
                ) : (
                  <span className="text-fg">{c.title ?? c.filename}</span>
                )}
                {c.filename && (
                  <span className="ml-1 text-fg-muted">
                    {c.filename}
                    {c.page ? ` p.${c.page}` : ""}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function stepStatusOf(
  stage: ToolProgressState["stage"],
  step: Step,
): StepStatus {
  const currentIndex =
    stage === "done" ? STEP_ORDER.length : STEP_ORDER.indexOf(stage);
  const stepIndex = STEP_ORDER.indexOf(step);
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return stage === "done" ? "done" : "running";
  return "pending";
}

export function ActivityPanel({
  progress,
  planSummary,
  onStop,
}: {
  progress: ToolProgressState;
  planSummary?: string;
  onStop?: () => void;
}) {
  const tasks = progress.tasks ?? [];
  const isRunning = progress.stage !== "done";

  return (
    <section
      role="region"
      aria-label="활동"
      data-testid="activity-panel"
      className="flex h-full w-[400px] flex-none flex-col"
    >
      <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {tasks.length > 0 && (
          <div
            data-testid="activity-plan-summary"
            className="rounded-[10px] border border-primary/30 bg-primary-50 px-[13px] py-2.5 text-[12.5px] text-primary"
          >
            <b>계획</b> —{" "}
            {planSummary ??
              `서브 질문 ${tasks.length}개로 분해됨 · 워커별 독립 컨텍스트`}
          </div>
        )}

        {tasks.map((t, i) => (
          <WorkerCard key={t.id} task={t} index={i} />
        ))}

        <div className="mt-0.5 border-t border-border pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-fg-subtle">
            스텝 트레이스
          </div>
          <ol>
            {STEP_ORDER.map((step, i) => {
              const status = stepStatusOf(progress.stage, step);
              return (
                <li
                  key={step}
                  data-testid={`activity-step-${step}`}
                  data-status={status}
                  className="flex gap-2.5"
                >
                  <div className="flex flex-none flex-col items-center">
                    <span
                      aria-hidden="true"
                      className={`mt-[3px] h-[9px] w-[9px] flex-none rounded-full ${
                        status === "done"
                          ? "bg-success"
                          : status === "running"
                            ? "border-2 border-primary bg-primary-50 motion-safe:animate-[pulse_1.2s_ease-in-out_infinite]"
                            : "bg-border"
                      }`}
                    />
                    {i < STEP_ORDER.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={`w-0.5 flex-1 ${
                          status === "done" ? "bg-success" : "bg-border"
                        }`}
                      />
                    )}
                  </div>
                  <div
                    className={`pb-3 text-[12.5px] ${
                      status === "running"
                        ? "font-medium text-primary"
                        : "text-fg"
                    }`}
                  >
                    {STEP_LABELS[step]}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="flex-none border-t border-border p-4">
        <button
          type="button"
          data-testid="activity-stop-button"
          disabled={!isRunning}
          onClick={onStop}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-bg py-2 text-sm font-semibold text-fg hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 flex-none rounded-sm bg-fg"
          />
          실행 중지
        </button>
      </div>
    </section>
  );
}

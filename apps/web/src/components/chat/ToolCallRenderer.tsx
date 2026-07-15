"use client";

// components/chat/ToolCallRenderer.tsx — 스트림 위치에 인터리브되는 툴콜 카드.
//   헤더 = 툴명 + StatusChip(+MCP `server › tool` 라벨) · 본문 = args/result 펼침.
//   deep_research(멀티에이전트)는 실행 중 진행 컨텍스트(주제·경과·병렬 안내)와 완료 시
//   구조화 렌더(요약·References·리포트 카드)로 "깜깜이"를 해소한다(Track A, 계약 무변경).
import React, { useEffect, useRef, useState } from "react";
import type {
  ToolCallStatus,
  Citation,
  ToolProgressState,
} from "../../hooks/useSessionStream";
import { StatusChip } from "./StatusChip";

const LARGE_PAYLOAD_CHARS = 400;

// mcp-tool-adapter.ts mcpToolName() 이 생성하는 namespaced 이름(mcp:{serverId}:{toolName}).
function parseMcpLabel(name: string): string | null {
  if (!name.startsWith("mcp:")) return null;
  const [, serverId, ...rest] = name.split(":");
  const toolName = rest.join(":");
  if (!serverId || !toolName) return null;
  return `${serverId} › ${toolName}`;
}

// P12 orchestrator-worker 계열({task} 단일 필드)·deep_research(고정 이름) 판별.
function isMultiAgentTool(name: string, args: unknown): boolean {
  if (name === "deep_research") return true;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return false;
  }
  const keys = Object.keys(args as Record<string, unknown>);
  return (
    keys.length === 1 &&
    keys[0] === "task" &&
    typeof (args as Record<string, unknown>).task === "string"
  );
}

// 멀티에이전트 툴의 조사 주제 — deep_research 는 query, 그 외 파사드는 task.
function extractTopic(args: unknown): string | null {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return null;
  }
  const r = args as Record<string, unknown>;
  if (typeof r.query === "string" && r.query.trim()) return r.query.trim();
  if (typeof r.task === "string" && r.task.trim()) return r.task.trim();
  return null;
}

interface ResearchArtifact {
  artifactId: string;
  artifactKind: string;
  filename: string;
  sizeBytes: number;
  downloadUrl?: string;
}
interface ResearchResult {
  message?: string;
  citations?: Citation[];
  artifact?: ResearchArtifact;
}

// deep_research tool_result(kind:json data = {message, citations, artifact}) duck-type 파싱.
//   raw JSON <pre> 대신 구조화 렌더 대상인지 판별한다(그 외 툴은 null → 기존 raw 렌더).
function parseResearchResult(result: unknown): ResearchResult | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null;
  }
  const r = result as Record<string, unknown>;
  const hasArtifact =
    !!r.artifact &&
    typeof r.artifact === "object" &&
    !Array.isArray(r.artifact);
  const hasShape =
    Array.isArray(r.citations) || hasArtifact || typeof r.message === "string";
  if (!hasShape) return null;
  return {
    ...(typeof r.message === "string" ? { message: r.message } : {}),
    ...(Array.isArray(r.citations)
      ? { citations: r.citations as Citation[] }
      : {}),
    ...(hasArtifact ? { artifact: r.artifact as ResearchArtifact } : {}),
  };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarize(text: string): string {
  const firstLine = text.split("\n")[0] ?? "";
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// 실행 중 경과 시간(client 측 측정 — 서버 데이터 0). 카드 mount 시각 기준으로,
//   장시간(30~90초+) 무반응이 '멈춤'으로 오인되는 것을 막는 최소 생존 신호.
function useRunningElapsed(running: boolean): number {
  const startRef = useRef<number>(Date.now());
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const tick = () => setMs(Date.now() - startRef.current);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);
  return ms;
}

export function ToolCallRenderer({
  name,
  args,
  status,
  result,
  progress,
  onRetry,
}: {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result?: string | unknown;
  progress?: ToolProgressState;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mcpLabel = parseMcpLabel(name);
  const isMultiAgent = isMultiAgentTool(name, args);
  const topic = isMultiAgent ? extractTopic(args) : null;
  const research = status === "done" ? parseResearchResult(result) : null;
  const running = status === "running";
  const elapsedMs = useRunningElapsed(running);

  const argsText = stringify(args);
  const resultText = result !== undefined ? stringify(result) : "";
  const isLargePayload =
    argsText.length > LARGE_PAYLOAD_CHARS ||
    resultText.length > LARGE_PAYLOAD_CHARS;
  // 접힘 요약: deep_research 는 message 를, 그 외는 raw result 첫 줄을.
  const collapsedSummary = research?.message ?? (resultText || "");

  return (
    <div
      data-testid="tool-call"
      data-tool-status={status}
      className={`rounded-xl border bg-surface text-sm ${
        running && isMultiAgent ? "border-primary/30" : "border-border"
      }`}
    >
      {/* role=button div (not <button>) — 재시도 <button> 을 안전하게 중첩하기 위함. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-fg">{name}</span>
          {mcpLabel && (
            <span className="truncate text-xs text-fg-muted">{mcpLabel}</span>
          )}
          {isMultiAgent && (
            <span
              data-testid="multi-agent-badge"
              className="flex-none rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            >
              멀티에이전트
            </span>
          )}
        </span>
        <span className="flex flex-none items-center gap-2">
          {isMultiAgent && running && (
            <span className="font-mono text-xs tabular-nums text-fg-muted">
              {fmtElapsed(elapsedMs)}
            </span>
          )}
          <StatusChip status={status} />
          {status === "error" && onRetry && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetry();
              }}
              className="rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
            >
              재시도
            </button>
          )}
          <span aria-hidden="true" className="text-fg-muted">
            {expanded ? "▲" : "▼"}
          </span>
        </span>
      </div>

      {/* 실행 중 멀티에이전트: 불확정 진행바 + 주제 + 병렬 조사 안내 (생존 신호) */}
      {isMultiAgent && running && (
        <>
          <div className="h-0.5 overflow-hidden bg-primary/15">
            <div className="h-full w-1/3 animate-pulse bg-primary/60" />
          </div>
          <div className="space-y-1 border-t border-border px-3 py-2 text-xs text-fg-muted">
            {topic && (
              <div>
                주제: <b className="font-medium text-fg">{topic}</b>
              </div>
            )}
            <div>
              {progress?.label ??
                "여러 리서처가 하위질문을 병렬 조사 중 · 보통 30~90초 소요"}
            </div>
          </div>
        </>
      )}

      {/* 접힘 + 완료: 요약 한 줄 */}
      {status === "done" && collapsedSummary && !expanded && (
        <p className="truncate border-t border-border px-3 pb-2 pt-2 text-xs text-fg-muted">
          {summarize(collapsedSummary)}
        </p>
      )}

      {expanded && (
        <div className="space-y-2 border-t border-border px-3 py-2">
          <div>
            <div className="mb-1 text-xs font-medium text-fg-muted">인자</div>
            <pre
              className={`overflow-x-auto rounded-lg bg-bg p-2 text-xs ${
                isLargePayload ? "max-h-48 overflow-y-auto" : ""
              }`}
            >
              {argsText}
            </pre>
          </div>

          {progress?.tasks && progress.tasks.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-fg-muted">
                진행 상황{progress.label ? ` · ${progress.label}` : ""}
              </div>
              <ul className="space-y-1.5">
                {progress.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex-none text-xs ${
                        t.status === "running"
                          ? "text-primary"
                          : "text-fg-muted"
                      }`}
                    >
                      {t.status === "done"
                        ? "✓"
                        : t.status === "running"
                          ? "◐"
                          : t.status === "error"
                            ? "!"
                            : "○"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-fg">
                      {t.title}
                    </span>
                    {t.sourceCount ? (
                      <span className="flex-none text-xs text-fg-muted">
                        출처 {t.sourceCount}
                      </span>
                    ) : null}
                    <StatusChip status={t.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {research ? (
            <div className="space-y-2">
              {research.message && (
                <div className="text-xs text-fg-muted">{research.message}</div>
              )}
              {research.citations && research.citations.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-fg-muted">
                    References
                  </div>
                  <ul className="space-y-1">
                    {research.citations.map((c, i) => (
                      <li
                        key={`ref-${i}-${c.index}`}
                        className="flex items-baseline gap-2 text-xs"
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
                            <span className="text-fg">
                              {c.title ?? c.filename}
                            </span>
                          )}
                          <span className="ml-1.5 text-fg-muted">
                            {c.filename}
                            {c.page ? ` p.${c.page}` : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {research.artifact && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-bg p-2">
                  <span
                    aria-hidden="true"
                    className="grid h-8 w-8 flex-none place-items-center rounded-md bg-primary/10 text-primary"
                  >
                    📄
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-fg">
                      {research.artifact.filename}
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {research.artifact.artifactKind} ·{" "}
                      {fmtBytes(research.artifact.sizeBytes)}
                    </span>
                  </span>
                  {research.artifact.downloadUrl && (
                    <a
                      href={research.artifact.downloadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex-none rounded-lg border border-primary/30 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                    >
                      열기
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            resultText && (
              <div>
                <div className="mb-1 text-xs font-medium text-fg-muted">
                  결과
                </div>
                <pre
                  className={`overflow-x-auto rounded-lg bg-bg p-2 text-xs ${
                    isLargePayload ? "max-h-48 overflow-y-auto" : ""
                  }`}
                >
                  {resultText}
                </pre>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

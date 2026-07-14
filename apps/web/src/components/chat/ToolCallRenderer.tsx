"use client";

// components/chat/ToolCallRenderer.tsx — 스트림 위치에 인터리브되는 툴콜 카드.
//   헤더 = 툴명 + StatusChip(+MCP `server › tool` 라벨) · 본문 = args/result 펼침(대형 payload 는 스크롤 접힘).
import React, { useState } from "react";
import type { ToolCallStatus } from "../../hooks/useSessionStream";
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

export function ToolCallRenderer({
  name,
  args,
  status,
  result,
  onRetry,
}: {
  toolCallId: string;
  name: string;
  args: unknown;
  status: ToolCallStatus;
  result?: string | unknown;
  onRetry?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const mcpLabel = parseMcpLabel(name);
  const argsText = stringify(args);
  const resultText = result !== undefined ? stringify(result) : "";
  const isLargePayload =
    argsText.length > LARGE_PAYLOAD_CHARS ||
    resultText.length > LARGE_PAYLOAD_CHARS;

  return (
    <div
      data-testid="tool-call"
      data-tool-status={status}
      className="rounded-xl border border-border bg-surface text-sm"
    >
      {/* role=button div (not <button>) — 재시도 <button> 을 안전하게 중첩하기 위함
          (button 안에 button 은 무효 HTML/hydration 에러). 키보드는 Enter/Space 로 토글. */}
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
        </span>
        <span className="flex flex-none items-center gap-2">
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

      {status === "done" && resultText && !expanded && (
        <p className="truncate px-3 pb-2 text-xs text-fg-muted">
          {summarize(resultText)}
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
          {resultText && (
            <div>
              <div className="mb-1 text-xs font-medium text-fg-muted">결과</div>
              <pre
                className={`overflow-x-auto rounded-lg bg-bg p-2 text-xs ${
                  isLargePayload ? "max-h-48 overflow-y-auto" : ""
                }`}
              >
                {resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

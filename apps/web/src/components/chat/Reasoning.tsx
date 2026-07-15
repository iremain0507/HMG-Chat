"use client";

// components/chat/Reasoning.tsx — P10-T6-05 추론 접이식.
// 스트리밍 중엔 기본 펼침(진행 요약), 완료 시 "N초 생각" 칩으로 자동 접힘.
// 사용자가 직접 토글하면 이후 자동 접힘/펼침을 override 하지 않는다.
import React, { useEffect, useRef, useState } from "react";

export function Reasoning({
  content,
  streaming,
  durationSec,
}: {
  content: string;
  streaming: boolean;
  durationSec: number;
}) {
  const [expanded, setExpanded] = useState(streaming);
  const manual = useRef(false);
  const wasStreaming = useRef(streaming);

  useEffect(() => {
    if (!manual.current && wasStreaming.current && !streaming) {
      setExpanded(false);
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  if (!content) return null;

  return (
    <div className="mb-2 rounded-lg border border-border bg-surface text-sm">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          manual.current = true;
          setExpanded((e) => !e);
        }}
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-fg-muted hover:text-fg"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ›
        </span>
        {streaming ? "생각 중…" : `${durationSec}초 생각`}
      </button>
      {expanded && (
        <div className="whitespace-pre-wrap border-t border-border px-3 py-2 text-xs text-fg-muted">
          {content}
        </div>
      )}
    </div>
  );
}

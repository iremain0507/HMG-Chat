"use client";

// components/chat/CodeBlock.tsx — P10-T6-03 코드블록 문법하이라이트+복사+wrap 토글.
// react-markdown 의 `pre` 컴포넌트 오버라이드. 실제 하이라이트(rehype-highlight)는
// 이미 자식 <code> 에 적용된 상태로 전달되므로, 여기선 언어 라벨/복사/wrap chrome 만 담당.
// P13-T6-15: 카드 radius(10px) + 포커스 링 토큰 정렬.
import React, { isValidElement, useState, type ReactNode } from "react";
import { copyText } from "../../lib/clipboard";

export function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return "";
}

function extractLanguage(node: ReactNode): string | null {
  if (isValidElement<{ className?: string }>(node)) {
    const match = /language-(\S+)/.exec(node.props.className ?? "");
    return match?.[1] ?? null;
  }
  return null;
}

export function CodeBlock({ children }: { children?: ReactNode }) {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children);

  async function copy() {
    if (!(await copyText(extractText(children)))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-3 overflow-hidden rounded-[10px] border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 text-xs text-fg-muted">
        <span>{language ?? "text"}</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-label="줄바꿈"
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
            className="rounded p-0.5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
          >
            줄바꿈
          </button>
          <button
            type="button"
            aria-label="복사"
            onClick={() => void copy()}
            className="rounded p-0.5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
          >
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </div>
      <pre
        className={
          wrap
            ? "whitespace-pre-wrap break-words p-3 text-[13px]"
            : "overflow-x-auto p-3 text-[13px]"
        }
      >
        {children}
      </pre>
    </div>
  );
}

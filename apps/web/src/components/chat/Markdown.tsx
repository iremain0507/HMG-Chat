"use client";

// components/chat/Markdown.tsx — 어시스턴트 응답을 마크다운으로 렌더(ChatGPT/Claude 스타일).
// react-markdown + remark-gfm + rehype-highlight(코드 문법하이라이트). Hyundai WIA CI 토큰 기반.
import React, { isValidElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { CodeBlock, extractText } from "./CodeBlock";
import { Mermaid } from "./Mermaid";
import { remarkCitations } from "../../lib/citation-plugin";
import type { Citation } from "../../hooks/useSessionStream";

// 스트리밍 중 미닫힌 코드펜스(```)가 있으면 파서가 이후 텍스트를 통째로 삼켜버리므로,
// 짝이 맞지 않을 때만 임시로 닫아 코드블록으로 안전하게 렌더한다(완결 메시지는 그대로 둠).
function balanceFences(text: string): string {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

function CitationChip({
  index,
  citation,
  onClick,
}: {
  index: string;
  citation?: Citation;
  onClick?: (index: number) => void;
}) {
  return (
    <sup className="group relative">
      <button
        type="button"
        data-testid={`citation-chip-${index}`}
        onClick={() => onClick?.(Number(index))}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/10 px-1 align-super text-[10px] font-semibold text-primary hover:bg-primary/20"
      >
        {index}
      </button>
      {citation && (
        <span
          role="tooltip"
          data-testid={`citation-tooltip-${index}`}
          className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 w-56 -translate-x-1/2 rounded-lg border border-border bg-surface p-2 text-left text-xs normal-case text-fg opacity-0 shadow-md transition-opacity group-hover:opacity-100"
        >
          <span className="block font-semibold">{citation.filename}</span>
          <span className="mt-0.5 block text-fg-muted">{citation.snippet}</span>
        </span>
      )}
    </sup>
  );
}

export function Markdown({
  children,
  streaming,
  citations,
  onCitationClick,
}: {
  children: string;
  streaming?: boolean;
  citations?: Citation[];
  onCitationClick?: (index: number) => void;
}) {
  const content = streaming ? balanceFences(children) : children;
  return (
    <div className="chat-md space-y-3 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkCitations]}
        rehypePlugins={[rehypeHighlight, rehypeKatex]}
        components={{
          sup: (props) => {
            const index = (
              props as unknown as Record<string, string | undefined>
            )["data-citation-index"];
            if (!index) return <sup {...props} />;
            const citation = citations?.find((c) => String(c.index) === index);
            return (
              <CitationChip
                index={index}
                {...(citation ? { citation } : {})}
                {...(onCitationClick ? { onClick: onCitationClick } : {})}
              />
            );
          },
          p: (props) => <p className="whitespace-pre-wrap" {...props} />,
          a: (props) => (
            <a
              className="text-primary underline underline-offset-2"
              target="_blank"
              rel="noreferrer"
              {...props}
            />
          ),
          ul: (props) => <ul className="list-disc space-y-1 pl-5" {...props} />,
          ol: (props) => (
            <ol className="list-decimal space-y-1 pl-5" {...props} />
          ),
          code: ({ className, children, ...props }) => {
            if (className) {
              // rehype-highlight 는 `pre > code` 에만 class(hljs, language-*)를 붙인다 —
              // 블록 코드는 CodeBlock(`pre` 오버라이드)이 chrome 을 담당.
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[13px]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: (props) => {
            const child = props.children;
            if (
              isValidElement<{
                className?: string;
                children?: React.ReactNode;
              }>(child) &&
              /language-mermaid/.test(child.props.className ?? "")
            ) {
              return <Mermaid code={extractText(child.props.children)} />;
            }
            return <CodeBlock {...props} />;
          },
          table: (props) => (
            <div className="overflow-x-auto">
              <table {...props} />
            </div>
          ),
          h1: (props) => <h1 className="text-lg font-bold" {...props} />,
          h2: (props) => <h2 className="text-base font-bold" {...props} />,
          h3: (props) => <h3 className="font-semibold" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="border-l-2 border-border pl-3 text-fg-muted"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

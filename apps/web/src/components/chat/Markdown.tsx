"use client";

// components/chat/Markdown.tsx — 어시스턴트 응답을 마크다운으로 렌더(ChatGPT/Claude 스타일).
// react-markdown + remark-gfm + rehype-highlight(코드 문법하이라이트). Hyundai WIA CI 토큰 기반.
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";

// 스트리밍 중 미닫힌 코드펜스(```)가 있으면 파서가 이후 텍스트를 통째로 삼켜버리므로,
// 짝이 맞지 않을 때만 임시로 닫아 코드블록으로 안전하게 렌더한다(완결 메시지는 그대로 둠).
function balanceFences(text: string): string {
  const fenceCount = (text.match(/^```/gm) ?? []).length;
  return fenceCount % 2 === 1 ? `${text}\n\`\`\`` : text;
}

export function Markdown({
  children,
  streaming,
}: {
  children: string;
  streaming?: boolean;
}) {
  const content = streaming ? balanceFences(children) : children;
  return (
    <div className="chat-md space-y-3 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
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
          pre: CodeBlock,
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

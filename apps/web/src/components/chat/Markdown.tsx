"use client";

// components/chat/Markdown.tsx — 어시스턴트 응답을 마크다운으로 렌더(ChatGPT/Claude 스타일).
// react-markdown + remark-gfm. Hyundai WIA CI 토큰 기반 타이포/코드 스타일.
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="chat-md space-y-3 leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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
          code: ({ className: _className, children, ...props }) => {
            const isBlock = /\n/.test(String(children));
            if (isBlock) {
              return (
                <code
                  className="block overflow-x-auto rounded-lg border border-border bg-surface p-3 font-mono text-[13px]"
                  {...props}
                >
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
          pre: (props) => <pre className="overflow-x-auto" {...props} />,
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
        {children}
      </ReactMarkdown>
    </div>
  );
}

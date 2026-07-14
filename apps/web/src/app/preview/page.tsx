"use client";

// app/preview/page.tsx — P10 브라우저 검증용 컴포넌트 갤러리 (dev 전용, 인증/서버 불필요).
//   Playwright(e2e/*.pw.ts)가 이 라우트를 headless 로 열어 실제 렌더/CSS/인터랙션을 검증.
//   각 FE 태스크는 자기 컴포넌트를 data-testid="preview-<name>" 섹션으로 여기에 추가한다.
import React, { useState } from "react";
import { ThemeToggle } from "../../components/layout/ThemeToggle";
import { Markdown } from "../../components/chat/Markdown";
import { Reasoning } from "../../components/chat/Reasoning";
import { MessageActions } from "../../components/chat/MessageActions";
import { ToolCallRenderer } from "../../components/chat/ToolCallRenderer";
import { HitlPrompt } from "../../components/chat/HitlPrompt";
import type { Citation } from "../../hooks/useSessionStream";

const CITATIONS: Citation[] = [
  {
    index: 1,
    source: "project",
    documentId: "doc-1",
    filename: "manual.pdf",
    page: 3,
    snippet: "42 는 만물의 답이다.",
  },
  {
    index: 2,
    source: "ephemeral",
    uploadId: "upload-1",
    filename: "notes.md",
    snippet: "세션에 첨부된 임시 메모.",
  },
];

function CitationPreview() {
  const [focused, setFocused] = useState<number | null>(null);
  return (
    <div>
      <Markdown citations={CITATIONS} onCitationClick={setFocused}>
        {"정답은 42입니다[1]. 추가로 메모도 참고했습니다[2]."}
      </Markdown>
      <div
        data-testid="citation-reference-footer"
        className="mt-3 border-t border-border pt-2 text-xs text-fg-muted"
      >
        <div className="font-semibold text-fg">Reference</div>
        <ul className="mt-1 space-y-1">
          {CITATIONS.map((c) => (
            <li
              key={c.index}
              id={`citation-ref-${c.index}`}
              data-testid={`citation-ref-${c.index}`}
              data-focused={focused === c.index}
              className="rounded px-1 py-0.5 data-[focused=true]:bg-primary/10 data-[focused=true]:text-fg"
            >
              [{c.index}] {c.filename}
              {c.page ? ` p.${c.page}` : ""}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const MD = `# 렌더 검증

**볼드**, _이탤릭_, 그리고 \`인라인 코드\`.

\`\`\`ts
const answer: number = 42;
function greet(name: string) {
  return \`안녕 \${name}\`;
}
\`\`\`

| 열 A | 열 B |
| --- | --- |
| 1 | 2 |

인라인 수식 $E = mc^2$ 그리고 블록:

$$\\int_0^1 x^2\\,dx = \\tfrac13$$
`;

function Section({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-testid={`preview-${name}`}
      className="rounded-lg border border-border p-4"
    >
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {name}
      </h2>
      {children}
    </section>
  );
}

export default function PreviewGallery() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 bg-bg p-6 text-fg">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-primary">
          P10 컴포넌트 프리뷰
        </h1>
        <ThemeToggle />
      </div>

      <Section name="markdown">
        <Markdown>{MD}</Markdown>
      </Section>

      <Section name="reasoning">
        <Reasoning
          content={"단계 1: 문제 파악\n단계 2: 근거 수집\n단계 3: 답변 구성"}
          streaming={false}
          durationSec={3}
        />
      </Section>

      <Section name="message-actions">
        <MessageActions role="assistant" content="복사 대상 텍스트" />
      </Section>

      <Section name="tool-call-renderer">
        <div className="space-y-3">
          <ToolCallRenderer
            toolCallId="preview-running"
            name="knowledge_search"
            args={{ query: "wchat" }}
            status="running"
          />
          <ToolCallRenderer
            toolCallId="preview-done"
            name="mcp:srv-1:search"
            args={{ query: "wchat rollout" }}
            status="done"
            result="검색 결과 3건: A, B, C"
          />
          <ToolCallRenderer
            toolCallId="preview-error"
            name="bash"
            args={{ cmd: "ls -la" }}
            status="error"
            result={{ error: { code: "TOOL_NOT_FOUND", message: "no" } }}
            onRetry={() => {}}
          />
        </div>
      </Section>

      <Section name="citation">
        <CitationPreview />
      </Section>

      <Section name="hitl-prompt">
        <HitlPrompt
          request={{
            toolCallId: "preview-hitl-1",
            toolName: "send_email",
            args: { to: "a@b.com", subject: "안녕하세요" },
            rationale: "외부로 이메일을 발송합니다.",
            expiresAt: "2026-07-14T00:05:00.000Z",
          }}
          onRespond={() => {}}
        />
      </Section>
    </div>
  );
}

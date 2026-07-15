"use client";

// components/chat/Mermaid.tsx — P10-T6-04 수식·다이어그램: mermaid 코드→SVG, 코드/다이어그램 토글 카드.
// P13-T6-15: 카드 radius(10px) + 포커스 링 토큰 정렬.
import React, { useEffect, useId, useState } from "react";

export function Mermaid({ code }: { code: string }) {
  const id = useId().replace(/[:]/g, "-");
  const [view, setView] = useState<"diagram" | "code">("diagram");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    setSvg(null);
    import("mermaid")
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: "neutral" });
        const { svg: rendered } = await mermaid.render(`mermaid-${id}`, code);
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, code]);

  return (
    <div className="my-3 overflow-hidden rounded-[10px] border border-border">
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5 text-xs text-fg-muted">
        <span>mermaid</span>
        <div className="flex gap-2">
          <button
            type="button"
            aria-pressed={view === "diagram"}
            onClick={() => setView("diagram")}
            className="rounded p-0.5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
          >
            다이어그램
          </button>
          <button
            type="button"
            aria-pressed={view === "code"}
            onClick={() => setView("code")}
            className="rounded p-0.5 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
          >
            코드
          </button>
        </div>
      </div>
      {view === "code" || error || !svg ? (
        <pre className="overflow-x-auto p-3 text-[13px]">
          <code>{code}</code>
          {error ? (
            <div className="pt-2 text-xs text-accent">
              다이어그램을 렌더하지 못했습니다.
            </div>
          ) : null}
        </pre>
      ) : (
        <div
          className="overflow-x-auto p-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </div>
  );
}

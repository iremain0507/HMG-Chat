"use client";

// components/artifacts/ArtifactPanel.tsx — 18-FRONTEND-WIREFRAMES § artifacts "우측 패널".
// 16-API-CONTRACT § 7 GET /artifacts/:id 응답 shape 을 그대로 반영한 DTO.
// P13-T6-15: 포커스 링 토큰 정렬.
// markdown/html 은 콘텐츠(text)를 fetch 해 인패널 렌더(markdown=채팅 Markdown 재사용,
//   html=scripts 차단 sandbox iframe). pdf/pptx 는 전용 렌더러. 그 외는 다운로드 안내.
import React, { useEffect, useState } from "react";
import { PdfRenderer } from "./PdfRenderer";
import { PptxRenderer } from "./PptxRenderer";
import { Markdown } from "../chat/Markdown";
import { apiFetch } from "../../lib/fetch-with-refresh";

export interface ArtifactDto {
  id: string;
  type:
    "pptx" | "pdf" | "docx" | "xlsx" | "markdown" | "html" | "image" | "other";
  filename: string;
  sizeBytes: number;
  storageKind: "inline" | "s3";
  downloadUrl: string | null;
  createdAt: string;
}

// 인패널 텍스트 렌더가 필요한 kind — 콘텐츠를 fetch 한다.
const TEXT_KINDS = new Set(["markdown", "html"]);

export function ArtifactPanel({ artifact }: { artifact: ArtifactDto }) {
  const contentUrl = `/api/v1/artifacts/${artifact.id}/content`;
  const needsText = TEXT_KINDS.has(artifact.type);
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (!needsText) return;
    let cancelled = false;
    setContent(null);
    apiFetch(contentUrl)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch(() => {
        if (!cancelled) setContent("(콘텐츠를 불러오지 못했습니다)");
      });
    return () => {
      cancelled = true;
    };
  }, [contentUrl, needsText]);

  return (
    <section>
      <div className="flex items-center justify-between">
        <span className="text-fg">{artifact.filename}</span>
        <a
          href={contentUrl}
          className="rounded text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
        >
          다운로드
        </a>
      </div>
      {artifact.type === "pdf" ? (
        <PdfRenderer url={contentUrl} />
      ) : artifact.type === "pptx" ? (
        <PptxRenderer contentUrl={contentUrl} />
      ) : artifact.type === "markdown" ? (
        content === null ? (
          <p className="mt-3 text-fg-muted">불러오는 중…</p>
        ) : (
          <div data-testid="artifact-markdown" className="mt-3 text-sm text-fg">
            <Markdown>{content}</Markdown>
          </div>
        )
      ) : artifact.type === "html" ? (
        content === null ? (
          <p className="mt-3 text-fg-muted">불러오는 중…</p>
        ) : (
          <iframe
            title={artifact.filename}
            sandbox=""
            srcDoc={content}
            data-testid="artifact-html"
            className="mt-3 h-[60vh] w-full rounded-md border border-border"
          />
        )
      ) : (
        <p className="text-fg-muted">이 형식은 미리보기를 지원하지 않습니다.</p>
      )}
    </section>
  );
}

"use client";

// components/artifacts/PptxRenderer.tsx — 18-FRONTEND-WIREFRAMES § artifacts.
// PPTX 는 브라우저가 직접 렌더 불가 — contentUrl(server 가 office-pdf-converter 로 이미
// PDF 로 변환해 서빙, L17)에서 blob 을 fetch 해 PdfRenderer 에 위임한다.
import React, { useEffect, useState } from "react";
import { apiFetch } from "../../lib/fetch-with-refresh";
import { PdfRenderer } from "./PdfRenderer";

export function PptxRenderer({ contentUrl }: { contentUrl: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    apiFetch(contentUrl)
      .then((res) => {
        if (!res.ok) throw new Error("변환 실패");
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentUrl]);

  if (error) {
    return <p className="text-accent">PPTX 미리보기 변환에 실패했습니다.</p>;
  }

  if (!blobUrl) {
    return <p className="text-fg-muted">변환 중…</p>;
  }

  return <PdfRenderer url={blobUrl} />;
}

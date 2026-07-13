"use client";

// components/artifacts/PdfRenderer.tsx — 18-FRONTEND-WIREFRAMES § artifacts, react-pdf 기반.
import React, { useState } from "react";
import { Document, Page } from "react-pdf";

export function PdfRenderer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber] = useState(1);
  const [error, setError] = useState(false);

  if (error) {
    return <p className="text-accent">PDF를 불러오지 못했습니다.</p>;
  }

  return (
    <div>
      <Document
        file={url}
        onLoadSuccess={(doc: { numPages: number }) => setNumPages(doc.numPages)}
        onLoadError={() => setError(true)}
      >
        <Page pageNumber={pageNumber} />
      </Document>
      {numPages !== null && (
        <p className="text-fg-muted">
          {pageNumber} / {numPages} 페이지
        </p>
      )}
    </div>
  );
}

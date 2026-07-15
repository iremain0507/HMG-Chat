"use client";

// components/artifacts/ArtifactPanel.tsx — 18-FRONTEND-WIREFRAMES § artifacts "우측 패널".
// 16-API-CONTRACT § 7 GET /artifacts/:id 응답 shape 을 그대로 반영한 DTO.
import React from "react";
import { PdfRenderer } from "./PdfRenderer";
import { PptxRenderer } from "./PptxRenderer";

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

export function ArtifactPanel({ artifact }: { artifact: ArtifactDto }) {
  const contentUrl = `/api/v1/artifacts/${artifact.id}/content`;

  return (
    <section>
      <div className="flex items-center justify-between">
        <span className="text-fg">{artifact.filename}</span>
        <a href={contentUrl} className="text-primary">
          다운로드
        </a>
      </div>
      {artifact.type === "pdf" ? (
        <PdfRenderer url={contentUrl} />
      ) : artifact.type === "pptx" ? (
        <PptxRenderer contentUrl={contentUrl} />
      ) : (
        <p className="text-fg-muted">이 형식은 미리보기를 지원하지 않습니다.</p>
      )}
    </section>
  );
}

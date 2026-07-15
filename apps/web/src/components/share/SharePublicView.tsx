"use client";

// components/share/SharePublicView.tsx — 18-FRONTEND-WIREFRAMES § 18.5.5 /share/[token].
// 익명 접근(AppShell 미사용) — 존재하지 않는 토큰은 notFound(), 만료/revoke(410, API가
// 둘을 구분하지 않음)는 동일한 410 안내 화면으로 표시한다.
import React from "react";
import { notFound } from "next/navigation";
import { useShare } from "../../hooks/useShare";
import { PdfRenderer } from "../artifacts/PdfRenderer";
import { PptxRenderer } from "../artifacts/PptxRenderer";

export function SharePublicView({ token }: { token: string }) {
  const {
    share,
    loading,
    notFound: shareNotFound,
    gone,
    error,
  } = useShare(token);

  if (loading) return <p>불러오는 중…</p>;
  if (shareNotFound) notFound();
  if (gone) {
    return (
      <section>
        <h1 className="text-2xl font-semibold text-accent">410</h1>
        <p className="text-fg">이 링크는 만료되었거나 취소되었습니다.</p>
      </section>
    );
  }
  if (error) return <p className="text-accent">{error}</p>;
  if (!share) return null;

  const contentUrl = `/api/v1/share/${token}/content`;

  return (
    <section>
      <div className="flex items-center justify-between">
        <span className="text-fg">{share.filename}</span>
        <a href={contentUrl} className="text-primary">
          다운로드
        </a>
      </div>
      {share.type === "pdf" ? (
        <PdfRenderer url={contentUrl} />
      ) : share.type === "pptx" ? (
        <PptxRenderer contentUrl={contentUrl} />
      ) : (
        <p className="text-fg-muted">이 형식은 미리보기를 지원하지 않습니다.</p>
      )}
      <p className="text-fg-muted">
        이 링크는 {share.expiresAt.slice(0, 10)} 까지 유효합니다.
      </p>
    </section>
  );
}

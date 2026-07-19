"use client";

// components/share/SharePublicView.tsx — 18-FRONTEND-WIREFRAMES § 18.5.5 /share/[token].
// 익명 접근(AppShell 미사용) — 존재하지 않는 토큰은 notFound(), 만료/revoke(410)는
// 서버가 내려주는 reason(expired|revoked)으로 만료(시계)·취소(금지) 화면을 구분한다(P22-T4-02).
import React from "react";
import { notFound } from "next/navigation";
import { Ban, Clock } from "lucide-react";
import { useShare } from "../../hooks/useShare";
import { PdfRenderer } from "../artifacts/PdfRenderer";
import { PptxRenderer } from "../artifacts/PptxRenderer";

function ShareSignature() {
  return (
    <div className="mb-6 flex items-center gap-2.5">
      <div
        aria-hidden="true"
        data-testid="share-signature-placeholder"
        className="flex h-[22px] w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-fg-subtle px-1 text-center text-[7.5px] leading-tight text-fg-subtle"
      >
        HYUNDAI WIA
        <br />
        시그니처 원본
      </div>
      <div className="h-[18px] w-px shrink-0 bg-border" />
      <span
        data-testid="share-signature-label"
        className="text-[15px] font-semibold tracking-tight text-fg"
      >
        Share
      </span>
    </div>
  );
}

function ShareGoneScreen({ reason }: { reason: "expired" | "revoked" | null }) {
  const revoked = reason === "revoked";
  const copy = revoked
    ? "이 링크는 취소되었습니다."
    : reason === "expired"
      ? "이 링크는 만료되었습니다."
      : "이 링크는 만료되었거나 취소되었습니다.";
  return (
    <section className="w-full max-w-md text-center">
      <ShareSignature />
      {revoked ? (
        <Ban
          aria-hidden="true"
          data-testid="share-gone-revoked"
          size={48}
          strokeWidth={1.5}
          className="mx-auto text-accent"
        />
      ) : (
        <Clock
          aria-hidden="true"
          data-testid="share-gone-expired"
          size={48}
          strokeWidth={1.5}
          className="mx-auto text-fg-subtle"
        />
      )}
      <h1 className="mt-4 text-2xl font-semibold text-accent">410</h1>
      <p className="mt-2 text-fg-muted">{copy}</p>
    </section>
  );
}

export function SharePublicView({ token }: { token: string }) {
  const {
    share,
    loading,
    notFound: shareNotFound,
    gone,
    goneReason,
    error,
  } = useShare(token);

  if (loading) return <p className="text-fg-muted">불러오는 중…</p>;
  if (shareNotFound) notFound();
  if (gone) {
    return <ShareGoneScreen reason={goneReason} />;
  }
  if (error)
    return (
      <p className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
        {error}
      </p>
    );
  if (!share) return null;

  const contentUrl = `/api/v1/share/${token}/content`;

  return (
    <section className="w-full max-w-md rounded-[14px] border border-border bg-surface p-6">
      <ShareSignature />
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-fg">
          {share.filename}
        </span>
        <a
          href={contentUrl}
          className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm text-primary hover:border-primary"
        >
          다운로드
        </a>
      </div>
      <div className="mt-4">
        {share.type === "pdf" ? (
          <PdfRenderer url={contentUrl} />
        ) : share.type === "pptx" ? (
          <PptxRenderer contentUrl={contentUrl} />
        ) : (
          <p className="text-fg-muted">
            이 형식은 미리보기를 지원하지 않습니다.
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-fg-muted">
        이 링크는 {share.expiresAt.slice(0, 10)} 까지 유효합니다.
      </p>
    </section>
  );
}

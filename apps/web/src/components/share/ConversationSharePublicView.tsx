"use client";

// components/share/ConversationSharePublicView.tsx — P20-T1-08 대화 스냅샷 공유.
// components/share/SharePublicView.tsx(아티팩트 공유) 와 동일한 시각 언어(ShareSignature,
// loading/notFound/gone/error 4 상태)를 GET /api/v1/conversation-shares/:token 계약으로
// 재사용한다. 존재하지 않는 토큰은 notFound(), 만료/revoke(410)는 서버가 내려주는
// reason(expired|revoked)으로 만료(시계)·취소(금지) 화면을 구분한다(P22-T4-02).
import React from "react";
import { notFound } from "next/navigation";
import { Ban, Clock } from "lucide-react";
import {
  useConversationShare,
  type ConversationShareMessageDto,
} from "../../hooks/useConversationShare";

const ROLE_LABEL: Record<string, string> = {
  user: "사용자",
  assistant: "어시스턴트",
};

function roleLabel(role: string): string {
  return ROLE_LABEL[role] ?? role;
}

function messageText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

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

function ConversationMessageItem({
  message,
}: {
  message: ConversationShareMessageDto;
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <span className="text-xs font-semibold text-primary">
        {roleLabel(message.role)}
      </span>
      <p className="mt-1 whitespace-pre-wrap text-sm text-fg">
        {messageText(message.content)}
      </p>
    </div>
  );
}

export function ConversationSharePublicView({ token }: { token: string }) {
  const {
    share,
    loading,
    notFound: shareNotFound,
    gone,
    goneReason,
    error,
  } = useConversationShare(token);

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

  return (
    <section className="w-full max-w-lg rounded-[14px] border border-border bg-surface p-6">
      <ShareSignature />
      <h1 className="truncate text-sm font-medium text-fg">
        {share.title ?? "대화 스냅샷"}
      </h1>
      <div className="mt-4 max-h-[60vh] space-y-3 overflow-y-auto">
        {share.messages.map((m) => (
          <ConversationMessageItem key={m.id} message={m} />
        ))}
      </div>
      <p className="mt-4 text-xs text-fg-muted">
        이 스냅샷은 {share.capturedAt.slice(0, 10)} 에 생성되었습니다.
      </p>
    </section>
  );
}

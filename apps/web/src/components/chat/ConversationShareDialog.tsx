"use client";

// components/chat/ConversationShareDialog.tsx — P20-T1-08 대화 스냅샷 공유.
// components/artifacts/ShareDialog.tsx(아티팩트 공유) 와 동일한 시각 언어(생성/복사/해제)를
// POST/DELETE /api/v1/sessions/:id/share-snapshot 계약으로 재사용한다.
import React, { useRef, useState } from "react";
import { apiFetch } from "../../lib/fetch-with-refresh";
import { copyText } from "../../lib/clipboard";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface ConversationShareLink {
  token: string;
  url: string;
  expiresAt: string | null;
}

export function ConversationShareDialog({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<ConversationShareLink | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { active: true, onClose });

  async function generate() {
    setPending(true);
    try {
      const res = await apiFetch(
        `/api/v1/sessions/${sessionId}/share-snapshot`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json();
      setLink(json.data);
    } finally {
      setPending(false);
    }
  }

  async function revoke() {
    if (!link) return;
    setPending(true);
    try {
      await apiFetch(
        `/api/v1/sessions/${sessionId}/share-snapshot/${link.token}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      setLink(null);
      setCopied(false);
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!link) return;
    // copyText: 비보안 컨텍스트(http Tailscale 등)에선 execCommand 폴백으로 복사.
    if (await copyText(link.url)) setCopied(true);
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="대화 스냅샷 공유"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">대화 스냅샷 공유</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded-md p-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            ✕
          </button>
        </div>

        {link ? (
          <div className="mt-3 space-y-2">
            <input
              readOnly
              aria-label="공유 링크"
              value={link.url}
              className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copy()}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:border-primary hover:text-fg"
              >
                {copied ? "복사됨" : "복사"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void revoke()}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-accent hover:border-accent disabled:opacity-40"
              >
                링크 해제
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => void generate()}
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:opacity-40"
            >
              스냅샷 공유 링크 생성
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

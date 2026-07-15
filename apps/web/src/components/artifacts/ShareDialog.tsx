"use client";

// components/artifacts/ShareDialog.tsx — 19-UIUX-UPGRADE.md § P10-T6-10,
// 16-API-CONTRACT § 8 Artifact Shares(POST/DELETE /artifacts/:id/share) 단일 출처.
import React, { useState } from "react";

interface ShareLink {
  token: string;
  url: string;
  expiresAt: string;
}

export function ShareDialog({
  artifactId,
  onClose,
}: {
  artifactId: string;
  onClose: () => void;
}) {
  const [link, setLink] = useState<ShareLink | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setPending(true);
    try {
      const res = await fetch(`/api/v1/artifacts/${artifactId}/share`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
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
      await fetch(`/api/v1/artifacts/${artifactId}/share/${link.token}`, {
        method: "DELETE",
        credentials: "include",
      });
      setLink(null);
      setCopied(false);
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // clipboard 미지원 환경 — 조용히 무시(수동 선택-복사로 대체 가능)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-fg/40 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="공유"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl border border-border bg-surface p-4 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg">아티팩트 공유</h2>
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
              공유 링크 생성
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

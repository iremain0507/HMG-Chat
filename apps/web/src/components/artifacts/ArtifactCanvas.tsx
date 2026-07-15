"use client";

// components/artifacts/ArtifactCanvas.tsx — 19-UIUX-UPGRADE.md § P10-T6-10.
// 우측 리사이즈 분할 패널 — ArtifactPanel(미리보기)을 감싸 코드 토글·버전 페이저·
// 공유(ShareDialog)·다운로드·닫기를 더한다. 데스크톱=사이드 패널(드래그 리사이즈),
// 모바일=풀스크린 시트(--z-modal). artifact_created 자동오픈/Cmd+\ 토글은 ChatView 소관.
import React, { useEffect, useState } from "react";
import { ArtifactPanel, type ArtifactDto } from "./ArtifactPanel";
import { ShareDialog } from "./ShareDialog";

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 420;

export interface ArtifactCanvasArtifact {
  artifactId: string;
  artifactKind: string;
  filename: string;
  sizeBytes: number;
  downloadUrl?: string;
}

const KNOWN_TYPES: ReadonlyArray<ArtifactDto["type"]> = [
  "pptx",
  "pdf",
  "docx",
  "xlsx",
  "markdown",
  "html",
  "image",
  "other",
];

function toArtifactDto(a: ArtifactCanvasArtifact): ArtifactDto {
  const type = KNOWN_TYPES.includes(a.artifactKind as ArtifactDto["type"])
    ? (a.artifactKind as ArtifactDto["type"])
    : "other";
  return {
    id: a.artifactId,
    type,
    filename: a.filename,
    sizeBytes: a.sizeBytes,
    storageKind: a.downloadUrl ? "s3" : "inline",
    downloadUrl: a.downloadUrl ?? null,
    createdAt: new Date(0).toISOString(),
  };
}

export function ArtifactCanvas({
  artifacts,
  activeIndex,
  onActiveIndexChange,
  onClose,
}: {
  artifacts: ArtifactCanvasArtifact[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);

  const safeIndex = Math.min(Math.max(activeIndex, 0), artifacts.length - 1);
  const active = artifacts[safeIndex];

  useEffect(() => {
    setTab("preview");
    setCodeContent(null);
  }, [active?.artifactId]);

  useEffect(() => {
    if (tab !== "code" || !active || codeContent !== null) return;
    let cancelled = false;
    fetch(`/api/v1/artifacts/${active.artifactId}/content`)
      .then((res) => res.text())
      .then((text) => {
        if (!cancelled) setCodeContent(text);
      })
      .catch(() => {
        if (!cancelled) setCodeContent("(콘텐츠를 불러오지 못했습니다)");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, active, codeContent]);

  function onResizeHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    function onMove(moveEvent: MouseEvent) {
      const next = startWidth - (moveEvent.clientX - startX);
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  if (!active) return null;

  const contentUrl = `/api/v1/artifacts/${active.artifactId}/content`;

  return (
    <div
      data-testid="artifact-panel"
      style={{ ["--artifact-panel-width" as string]: `${width}px` }}
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col border-l border-border bg-surface md:static md:inset-auto md:z-auto md:h-full md:w-[var(--artifact-panel-width)] md:shrink-0"
    >
      <button
        type="button"
        aria-label="패널 크기 조절"
        onMouseDown={onResizeHandleMouseDown}
        className="absolute inset-y-0 left-0 hidden w-1 cursor-col-resize border-0 bg-transparent p-0 hover:bg-primary/30 md:block"
      />

      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-fg">
          {active.filename}
        </span>
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-bg hover:text-fg"
          >
            공유
          </button>
          <a
            href={contentUrl}
            download={active.filename}
            className="rounded-md px-2 py-1 text-xs text-fg-muted hover:bg-bg hover:text-fg"
          >
            다운로드
          </a>
          <button
            type="button"
            aria-label="아티팩트 패널 닫기"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-fg-muted hover:bg-bg hover:text-fg"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <button
          type="button"
          aria-pressed={tab === "preview"}
          onClick={() => setTab("preview")}
          className={`rounded-md px-2 py-1 text-xs ${
            tab === "preview"
              ? "bg-primary text-primary-fg"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          미리보기
        </button>
        <button
          type="button"
          aria-pressed={tab === "code"}
          onClick={() => setTab("code")}
          className={`rounded-md px-2 py-1 text-xs ${
            tab === "code"
              ? "bg-primary text-primary-fg"
              : "text-fg-muted hover:text-fg"
          }`}
        >
          코드
        </button>

        {artifacts.length > 1 && (
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              aria-label="이전 버전"
              disabled={safeIndex === 0}
              onClick={() => onActiveIndexChange(safeIndex - 1)}
              className="rounded-md px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
            >
              ‹
            </button>
            <span
              data-testid="artifact-version-pager"
              className="text-xs text-fg-muted"
            >
              {safeIndex + 1} / {artifacts.length}
            </span>
            <button
              type="button"
              aria-label="다음 버전"
              disabled={safeIndex === artifacts.length - 1}
              onClick={() => onActiveIndexChange(safeIndex + 1)}
              className="rounded-md px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "preview" ? (
          <ArtifactPanel artifact={toArtifactDto(active)} />
        ) : (
          <pre
            data-testid="artifact-code-view"
            className="whitespace-pre-wrap break-words text-xs text-fg"
          >
            {codeContent ?? "불러오는 중…"}
          </pre>
        )}
      </div>

      {shareOpen && (
        <ShareDialog
          artifactId={active.artifactId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

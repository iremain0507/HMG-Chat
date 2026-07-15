"use client";

// components/artifacts/ArtifactCanvas.tsx — 19-UIUX-UPGRADE.md § P10-T6-10,
// design-reference §4/§6 우측 컨텍스트 패널(P13-T6-08): 상위 탭 3개(아티팩트·출처·활동)
// 셸 — 아티팩트 탭은 ArtifactPanel(미리보기)을 감싸 코드 토글·버전 페이저 ‹vN/M›·
// 공유(ShareDialog)·다운로드를, 출처 탭은 인용 원문 목록+하이라이트를, 활동 탭은
// ActivityPanel(멀티에이전트 진행)을 각각 렌더한다. 데스크톱=사이드 패널(드래그 리사이즈),
// 모바일=풀스크린 시트(--z-modal). artifact_created 자동오픈/citation 클릭→출처 탭 전환/
// Cmd+\ 토글은 ChatView 소관(focusTab prop 으로 강제 전환 신호를 받는다).
import React, { useEffect, useState } from "react";
import { apiFetch } from "../../lib/fetch-with-refresh";
import type { Citation, ToolProgressState } from "../../hooks/useSessionStream";
import { ActivityPanel } from "../chat/ActivityPanel";
import { ArtifactPanel, type ArtifactDto } from "./ArtifactPanel";
import { ShareDialog } from "./ShareDialog";

const MIN_WIDTH = 320;
const MAX_WIDTH = 800;
const DEFAULT_WIDTH = 420;

type OuterTab = "artifacts" | "sources" | "activity";

const OUTER_TABS: ReadonlyArray<{ id: OuterTab; label: string }> = [
  { id: "artifacts", label: "아티팩트" },
  { id: "sources", label: "출처" },
  { id: "activity", label: "활동" },
];

function OuterTabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: OuterTab;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={`artifact-panel-tab-${id}`}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ${
        active
          ? "bg-primary text-primary-fg"
          : "text-fg-muted hover:bg-bg hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center text-sm text-fg-muted">
      {message}
    </div>
  );
}

function SourcesList({
  citations,
  focusedIndex,
}: {
  citations: Citation[];
  focusedIndex: number | null;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <ul className="space-y-2">
        {citations.map((c) => (
          <li
            key={c.index}
            id={`source-block-${c.index}`}
            data-testid={`source-item-${c.index}`}
            data-focused={focusedIndex === c.index}
            className="rounded-md border border-border p-2.5 text-sm transition-colors duration-[2000ms] data-[focused=true]:bg-primary-100"
          >
            <div className="font-mono text-xs text-fg-subtle">
              [{c.index}] {c.filename}
              {c.page ? ` p.${c.page}` : ""}
            </div>
            <p className="mt-1.5 text-fg-muted">{c.snippet}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
  citations = [],
  focusedCitationIndex = null,
  activityProgress,
  activityPlanSummary,
  onActivityStop,
  focusTab,
}: {
  artifacts: ArtifactCanvasArtifact[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  citations?: Citation[];
  focusedCitationIndex?: number | null;
  activityProgress?: ToolProgressState;
  activityPlanSummary?: string;
  onActivityStop?: () => void;
  // ChatView 가 이벤트(artifact_created/citation 클릭)마다 token 을 올려 강제 탭 전환을
  // 신호한다 — token 이 바뀔 때만 반영해 사용자가 수동으로 고른 탭을 리렌더마다 덮어쓰지 않는다.
  focusTab?: { tab: OuterTab; token: number };
}) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [codeContent, setCodeContent] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [outerTab, setOuterTab] = useState<OuterTab>(
    focusTab?.tab ?? "artifacts",
  );

  // focusTab.tab 은 token 이 바뀔 때만 반영하면 되므로 의도적으로 token 만 의존한다.
  useEffect(() => {
    if (focusTab) setOuterTab(focusTab.tab);
  }, [focusTab?.token]);

  const hasContent =
    artifacts.length > 0 || citations.length > 0 || !!activityProgress;

  const safeIndex = Math.min(Math.max(activeIndex, 0), artifacts.length - 1);
  const active = artifacts[safeIndex];

  useEffect(() => {
    setTab("preview");
    setCodeContent(null);
  }, [active?.artifactId]);

  useEffect(() => {
    if (tab !== "code" || !active || codeContent !== null) return;
    let cancelled = false;
    apiFetch(`/api/v1/artifacts/${active.artifactId}/content`)
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

  if (!hasContent) return null;

  const contentUrl = active
    ? `/api/v1/artifacts/${active.artifactId}/content`
    : "";

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

      <div
        role="tablist"
        aria-label="우측 컨텍스트 패널 탭"
        className="flex items-center gap-1 border-b border-border px-3 py-2"
      >
        {OUTER_TABS.map((t) => (
          <OuterTabButton
            key={t.id}
            id={t.id}
            label={t.label}
            active={outerTab === t.id}
            onClick={() => setOuterTab(t.id)}
          />
        ))}
        <div className="flex-1" />
        <button
          type="button"
          aria-label="아티팩트 패널 닫기"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-fg-muted hover:bg-bg hover:text-fg"
        >
          ✕
        </button>
      </div>

      {outerTab === "artifacts" &&
        (active ? (
          <>
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
                    className="font-mono text-xs tabular-nums text-fg-muted"
                  >
                    v{safeIndex + 1} / {artifacts.length}
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
          </>
        ) : (
          <PanelEmptyState message="표시할 아티팩트가 없습니다" />
        ))}

      {outerTab === "sources" &&
        (citations.length > 0 ? (
          <SourcesList
            citations={citations}
            focusedIndex={focusedCitationIndex}
          />
        ) : (
          <PanelEmptyState message="표시할 출처가 없습니다" />
        ))}

      {outerTab === "activity" &&
        (activityProgress ? (
          <ActivityPanel
            progress={activityProgress}
            {...(activityPlanSummary !== undefined
              ? { planSummary: activityPlanSummary }
              : {})}
            {...(onActivityStop ? { onStop: onActivityStop } : {})}
          />
        ) : (
          <PanelEmptyState message="표시할 활동이 없습니다" />
        ))}

      {shareOpen && active && (
        <ShareDialog
          artifactId={active.artifactId}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

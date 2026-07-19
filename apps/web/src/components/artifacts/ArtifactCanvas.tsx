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
const DEFAULT_WIDTH = 420;

// 패널 최대 폭 = **화면 가로(window.innerWidth)의 2/3** 까지(사용자 요청). 고정 800px 상한 제거.
// 단, 메인 채팅이 지나치게 좁아지거나 오버플로하지 않도록, 채팅+패널 컨테이너에서 메인 채팅
// 최소치(MIN_MAIN_CHAT)를 남기는 값으로도 캡한다. 컨테이너 측정 불가(jsdom 레이아웃 미계산)면
// 그 캡을 무시하고 화면 2/3 만 적용한다.
const MIN_MAIN_CHAT = 260;
function computeMaxPanelWidth(handle: HTMLElement): number {
  const screenW =
    typeof window !== "undefined" ? window.innerWidth : DEFAULT_WIDTH * 3;
  const byRatio = Math.round(screenW * (2 / 3));
  const container = handle.parentElement?.parentElement ?? null;
  const containerW = container ? container.getBoundingClientRect().width : 0;
  const byContainer =
    containerW > 0 ? Math.round(containerW - MIN_MAIN_CHAT) : Infinity;
  return Math.max(MIN_WIDTH + 80, Math.min(byRatio, byContainer));
}

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
  // '복원'(revert) 액션으로 승격된 버전 순서 — 서버 영속화 전까지는 클라 상태에서만
  // sibling 배열을 재정렬한다. artifacts prop 의 id 구성이 실제로 바뀔 때(새 버전
  // 생성/제거)만 리셋하고, 그 외 리렌더에서는 사용자가 승격한 순서를 유지한다.
  const [orderedArtifacts, setOrderedArtifacts] =
    useState<ArtifactCanvasArtifact[]>(artifacts);

  useEffect(() => {
    setOrderedArtifacts((prev) => {
      const prevIds = prev
        .map((a) => a.artifactId)
        .sort()
        .join(",");
      const nextIds = artifacts
        .map((a) => a.artifactId)
        .sort()
        .join(",");
      return prevIds === nextIds ? prev : artifacts;
    });
  }, [artifacts]);

  // focusTab.tab 은 token 이 바뀔 때만 반영하면 되므로 의도적으로 token 만 의존한다.
  useEffect(() => {
    if (focusTab) setOuterTab(focusTab.tab);
  }, [focusTab?.token]);

  const hasContent =
    orderedArtifacts.length > 0 || citations.length > 0 || !!activityProgress;

  const safeIndex = Math.min(
    Math.max(activeIndex, 0),
    orderedArtifacts.length - 1,
  );
  const active = orderedArtifacts[safeIndex];

  function handleRestore() {
    const target = orderedArtifacts[safeIndex];
    if (!target) return;
    const rest = orderedArtifacts.filter((_, i) => i !== safeIndex);
    const next = [...rest, target];
    setOrderedArtifacts(next);
    onActiveIndexChange(next.length - 1);
  }

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

  // pointer 이벤트로 마우스+터치(iPad 등)를 함께 지원한다. 핵심: 터치는 pointerdown 시 대상
  // 엘리먼트로 **암시적 포인터 캡처**가 걸려 이후 pointermove/up 이 window 가 아니라 그 엘리먼트로
  // 간다 — 그래서 window 리스너를 쓰면 iPad 등 터치에서 드래그가 전혀 먹지 않았다. setPointerCapture
  // 로 마우스도 핸들에 캡처하고, 리스너를 **핸들 자신**에 달아 마우스·터치 모두 잡는다.
  // touch-action:none(아래 style) 이 드래그 중 스크롤 개입을 막는다.
  function onResizeHandlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* jsdom 등 미구현 환경 — 무시(리스너로도 동작) */
    }
    const startX = e.clientX;
    const startWidth = width;
    const maxWidth = computeMaxPanelWidth(handle);
    function onMove(moveEvent: PointerEvent) {
      const next = startWidth - (moveEvent.clientX - startX);
      setWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, next)));
    }
    function onUp(upEvent: PointerEvent) {
      try {
        handle.releasePointerCapture(upEvent.pointerId);
      } catch {
        /* noop */
      }
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  if (!hasContent) return null;

  const contentUrl = active
    ? `/api/v1/artifacts/${active.artifactId}/content`
    : "";

  return (
    <div
      data-testid="artifact-panel"
      style={{ ["--artifact-panel-width" as string]: `${width}px` }}
      // md:relative(≠static) — 좌측 absolute 리사이즈 핸들이 뷰포트가 아니라 이 패널을 기준으로
      // 위치하도록 positioning context 를 만든다(static 이면 핸들이 화면 맨 왼쪽으로 튀어 못 잡음).
      className="fixed inset-0 z-[var(--z-modal)] flex flex-col border-l border-border bg-surface md:relative md:inset-auto md:z-auto md:h-full md:w-[var(--artifact-panel-width)] md:shrink-0"
    >
      <button
        type="button"
        aria-label="패널 크기 조절"
        data-testid="artifact-panel-resizer"
        onPointerDown={onResizeHandlePointerDown}
        style={{ touchAction: "none" }}
        className="group absolute inset-y-0 left-0 z-20 hidden w-10 -translate-x-1/2 cursor-col-resize items-center justify-center border-0 bg-transparent p-0 md:flex"
      >
        {/* 터치(iPad) 로 잡기 쉽게 넉넉한 히트영역(w-10=40px). 그립은 항상 또렷하게 보이는
            캡슐(세로 점 3개) — hover/드래그 시 primary. */}
        <span
          aria-hidden="true"
          className="flex h-20 w-2 flex-col items-center justify-center gap-1.5 rounded-full bg-fg-muted/40 shadow-sm ring-1 ring-border transition-colors group-hover:bg-primary group-active:bg-primary"
        >
          <span className="h-1 w-1 rounded-full bg-bg" />
          <span className="h-1 w-1 rounded-full bg-bg" />
          <span className="h-1 w-1 rounded-full bg-bg" />
        </span>
      </button>

      <span
        aria-hidden="true"
        data-testid="artifact-panel-grabber"
        className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border md:hidden"
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

              {orderedArtifacts.length > 1 && (
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
                    v{safeIndex + 1} / {orderedArtifacts.length}
                  </span>
                  <button
                    type="button"
                    aria-label="다음 버전"
                    disabled={safeIndex === orderedArtifacts.length - 1}
                    onClick={() => onActiveIndexChange(safeIndex + 1)}
                    className="rounded-md px-1.5 py-0.5 text-fg-muted hover:text-fg disabled:opacity-30"
                  >
                    ›
                  </button>
                  {safeIndex !== orderedArtifacts.length - 1 && (
                    <button
                      type="button"
                      onClick={handleRestore}
                      className="ml-1 rounded-md px-2 py-0.5 text-xs text-fg-muted hover:bg-bg hover:text-fg"
                    >
                      이 버전으로 복원
                    </button>
                  )}
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

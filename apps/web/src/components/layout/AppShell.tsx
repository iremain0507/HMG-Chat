"use client";

// components/layout/AppShell.tsx — design-reference/README.md §Screens/AppShell,
// claude-design-prompt §4 정보구조. 헤더(48px)+나비 레일(64px)+세션 사이드바(280px)+본문
// +우측 컨텍스트 패널(400px, ⌘\ 토글·드래그 리사이즈) 4분할 셸. 모바일 폭에서 레일·사이드바는
// 슬라이드오버.
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, PanelRight, PanelLeft, HelpCircle } from "lucide-react";
import { NavRail } from "./NavRail";
import { ThemeToggle } from "./ThemeToggle";
import { ToastContainer } from "./ToastContainer";
import { ShortcutSheet } from "./ShortcutSheet";

export interface AppShellProps {
  sidebar: React.ReactNode;
  rightPanel?: React.ReactNode;
  children: React.ReactNode;
}

const RIGHT_PANEL_MIN_WIDTH = 320;
const RIGHT_PANEL_MAX_WIDTH = 640;
const RIGHT_PANEL_DEFAULT_WIDTH = 400;

// SessionList(⌘K → 검색창 포커스) 등 sidebar 내부 컴포넌트에 헤더 검색 버튼의 클릭을
// 전달하기 위한 앱 전역 신호. AppShell 은 sidebar 내부 DOM 을 알지 못하므로 이벤트로 위임한다.
const CMDK_EVENT = "wchat:cmdk";

export function AppShell({ sidebar, rightPanel, children }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shortcutSheetOpen, setShortcutSheetOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(
    RIGHT_PANEL_DEFAULT_WIDTH,
  );
  const resizeState = useRef<{ startX: number; startWidth: number } | null>(
    null,
  );

  const openCommandSearch = useCallback(() => {
    window.dispatchEvent(new CustomEvent(CMDK_EVENT));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        openCommandSearch();
      } else if (e.key === "\\") {
        e.preventDefault();
        setRightPanelOpen((open) => !open);
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setSidebarCollapsed((collapsed) => !collapsed);
      } else if (e.key === "/") {
        e.preventDefault();
        setShortcutSheetOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openCommandSearch]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizeState.current) return;
      const { startX, startWidth } = resizeState.current;
      const next = startWidth - (e.clientX - startX);
      setRightPanelWidth(
        Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, next)),
      );
    }
    function onUp() {
      resizeState.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResize(e: React.MouseEvent) {
    resizeState.current = { startX: e.clientX, startWidth: rightPanelWidth };
  }

  return (
    <div
      data-testid="app-shell"
      className="flex h-[100dvh] w-full flex-col overflow-hidden bg-bg text-fg"
    >
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="사이드바 닫기"
          title="사이드바 닫기"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-[var(--z-modal)] bg-fg/40 md:hidden"
        />
      )}

      <header
        data-testid="app-shell-header"
        className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3.5"
      >
        <button
          type="button"
          aria-label="사이드바 열기"
          title="사이드바 열기"
          onClick={() => setMobileSidebarOpen(true)}
          className="rounded p-1.5 text-fg-muted hover:bg-surface md:hidden"
        >
          ☰
        </button>
        <button
          type="button"
          aria-label="사이드바 접기/펼치기 (⌘B)"
          title="사이드바 접기/펼치기 (⌘B)"
          aria-pressed={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          data-testid="app-shell-sidebar-toggle"
          className="hidden h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:border-primary hover:text-fg md:flex"
        >
          <PanelLeft size={14} strokeWidth={1.8} />
        </button>
        <div
          aria-hidden="true"
          data-testid="app-shell-signature-placeholder"
          className="flex h-[22px] w-24 shrink-0 items-center justify-center rounded-sm border border-dashed border-fg-subtle px-1 text-center text-[7.5px] leading-tight text-fg-subtle"
        >
          HYUNDAI WIA
          <br />
          시그니처 원본
        </div>
        <div className="h-[18px] w-px shrink-0 bg-border" />
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          WChat
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={openCommandSearch}
          aria-label="검색 (⌘K)"
          title="검색 (⌘K)"
          data-testid="app-shell-cmdk-button"
          className="flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-fg-subtle hover:border-primary hover:text-fg-muted"
        >
          <Search size={12} strokeWidth={2} />
          검색
          <span className="rounded-sm border border-border bg-surface px-1 font-mono text-[10px]">
            ⌘K
          </span>
        </button>
        <ThemeToggle />
        <button
          type="button"
          onClick={() => setShortcutSheetOpen(true)}
          aria-label="단축키 도움말 (⌘/)"
          title="단축키 도움말 (⌘/)"
          data-testid="app-shell-shortcuts-button"
          className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:border-primary hover:text-fg"
        >
          <HelpCircle size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => setRightPanelOpen((open) => !open)}
          aria-label="우패널 토글 (⌘\)"
          title="우패널 토글 (⌘\)"
          aria-pressed={rightPanelOpen}
          data-testid="app-shell-panel-toggle"
          className={`flex h-7 w-7 items-center justify-center rounded-md border ${
            rightPanelOpen
              ? "border-primary text-primary"
              : "border-border text-fg-muted"
          }`}
        >
          <PanelRight size={14} strokeWidth={1.8} />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="hidden md:flex">
          <NavRail />
        </div>

        <aside
          data-testid="app-shell-sidebar"
          data-mobile-open={mobileSidebarOpen}
          data-collapsed={sidebarCollapsed}
          className={`fixed inset-y-0 left-0 z-[var(--z-modal)] flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-all duration-200 md:static md:z-auto md:translate-x-0 ${
            mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } ${
            sidebarCollapsed
              ? "md:w-0 md:border-r-0 md:opacity-0 md:pointer-events-none"
              : "md:w-[280px] md:opacity-100"
          }`}
        >
          {sidebar}
        </aside>

        <main
          data-testid="app-shell-main"
          className="min-w-0 flex-1 overflow-y-auto"
        >
          {children}
        </main>

        {rightPanel && rightPanelOpen && (
          <aside
            data-testid="app-shell-right-panel"
            style={{
              ["--right-panel-width" as string]: `${rightPanelWidth}px`,
            }}
            className="fixed inset-0 z-[var(--z-modal)] flex shrink-0 border-l border-border bg-surface md:static md:inset-auto md:z-auto md:h-full md:w-[var(--right-panel-width)]"
          >
            <button
              type="button"
              aria-label="우패널 크기 조절"
              title="우패널 크기 조절"
              data-testid="app-shell-right-panel-resize-handle"
              onMouseDown={startResize}
              className="absolute inset-y-0 left-0 z-10 hidden w-1 cursor-col-resize bg-transparent hover:bg-primary/30 md:block"
            />
            <div className="min-w-0 flex-1 pl-1">{rightPanel}</div>
          </aside>
        )}
      </div>

      <ToastContainer />
      <ShortcutSheet
        open={shortcutSheetOpen}
        onClose={() => setShortcutSheetOpen(false)}
      />
    </div>
  );
}

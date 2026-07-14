"use client";

// components/layout/AppShell.tsx — 19-UIUX-UPGRADE.md § P10-T6-01
// 좌 nav rail(사이드바) + 본문 + 우패널 슬롯의 3분할 셸. 모바일 폭에서 사이드바는 슬라이드오버.
import React, { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export interface AppShellProps {
  sidebar: React.ReactNode;
  rightPanel?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({ sidebar, rightPanel, children }: AppShellProps) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div
      data-testid="app-shell"
      className="flex h-[100dvh] w-full overflow-hidden bg-bg text-fg"
    >
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="사이드바 닫기"
          onClick={() => setMobileSidebarOpen(false)}
          className="fixed inset-0 z-[var(--z-modal)] bg-fg/40 md:hidden"
        />
      )}

      <aside
        data-testid="app-shell-sidebar"
        data-mobile-open={mobileSidebarOpen}
        className={`fixed inset-y-0 left-0 z-[var(--z-modal)] flex w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
          <button
            type="button"
            aria-label="사이드바 열기"
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-md p-2 text-fg-muted hover:bg-surface md:hidden"
          >
            ☰
          </button>
          <div className="flex-1" />
          <ThemeToggle />
        </header>
        <main
          data-testid="app-shell-main"
          className="min-w-0 flex-1 overflow-y-auto"
        >
          {children}
        </main>
      </div>

      <aside
        data-testid="app-shell-right-panel"
        className="hidden w-96 shrink-0 border-l border-border bg-surface md:flex"
      >
        {rightPanel}
      </aside>
    </div>
  );
}

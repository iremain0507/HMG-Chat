import React from "react";
import { AppShell } from "../../components/layout/AppShell";

// (chat)/layout.tsx — 19-UIUX-UPGRADE.md § P10-T6-01. 세션 히스토리 사이드바 본문은 P10-T6-02.
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      sidebar={
        <div className="px-3 py-4 text-sm font-semibold text-primary">
          WChat
        </div>
      }
    >
      {children}
    </AppShell>
  );
}

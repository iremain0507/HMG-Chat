import React from "react";
import { AppShell } from "../../components/layout/AppShell";
import { SessionList } from "../../components/sessions/SessionList";

// (chat)/layout.tsx — 19-UIUX-UPGRADE.md § P10-T6-01/02. 세션 히스토리 사이드바(SessionList)를 마운트.
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell sidebar={<SessionList />}>{children}</AppShell>;
}

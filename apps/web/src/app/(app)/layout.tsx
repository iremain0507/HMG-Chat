import React from "react";
import { AppShell } from "../../components/layout/AppShell";
import { SessionList } from "../../components/sessions/SessionList";

// (app)/layout.tsx — P16-T6-01 (갭2·3): 인증 전 화면(홈·chat·projects·settings·admin)을
// 전부 AppShell(NavRail+헤더)+SessionList 히스토리 사이드바로 감싼다. 이전엔 (chat)/layout.tsx
// 로 /chat/* 에만 마운트돼 다른 인증 라우트에 전역 내비·히스토리가 없었다(21-LOOP-LESSONS L1).
// /login·/signup·/share/* 는 이 그룹 밖(app/(auth)/**, app/share/**)이라 shell 없음 유지.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell sidebar={<SessionList />}>{children}</AppShell>;
}

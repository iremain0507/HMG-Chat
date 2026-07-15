"use client";

// components/admin/AdminGuard.tsx — 18-FRONTEND-WIREFRAMES § /admin* "admin role 만" 접근 게이트.
// admin/owner 이외 role 은 렌더링 차단(백엔드 routes/admin.ts 의 auth.role 체크와 동일 기준).
import React from "react";
import { useCurrentUser } from "../../hooks/useCurrentUser";

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useCurrentUser();

  if (loading) return <p>불러오는 중…</p>;
  if (!user || (user.role !== "admin" && user.role !== "owner")) {
    return <p className="text-accent">접근 권한이 없습니다.</p>;
  }
  return <>{children}</>;
}

"use client";

// components/admin/AdminDashboard.tsx — 18-FRONTEND-WIREFRAMES § /admin 최소 구현:
// 카드 3개(users/sessions/errors) + tools 요약. 24h 카드 카운트만(비교 차트는 acceptance 범위 밖).
import React from "react";
import { useAdminDashboard } from "../../hooks/useAdminDashboard";

export function AdminDashboard() {
  const { summary, loading, error } = useAdminDashboard();

  if (loading) return <p>불러오는 중…</p>;
  if (error) return <p className="text-accent">{error}</p>;
  if (!summary) return null;

  return (
    <section>
      <div>
        <h2>Users</h2>
        <p>{summary.users.total}</p>
        <p>
          24h 활성 {summary.users.activeLast24h} · 7d 신규{" "}
          {summary.users.newLast7d}
        </p>
      </div>
      <div>
        <h2>Sessions</h2>
        <p>{summary.sessions.total}</p>
        <p>
          현재 활성 {summary.sessions.activeNow} · 24h 완료{" "}
          {summary.sessions.completedLast24h}
        </p>
      </div>
      <div>
        <h2>Errors</h2>
        <p>{summary.errors.last24h}</p>
        <p>
          7d {summary.errors.last7d} · critical {summary.errors.critical}
        </p>
      </div>
      <div>
        <h2>Tools</h2>
        <p>
          24h 호출 {summary.tools.totalCalls24h} · 에러율{" "}
          {(summary.tools.errorRate * 100).toFixed(1)}% · p50{" "}
          {summary.tools.p50LatencyMs}ms
        </p>
      </div>
    </section>
  );
}

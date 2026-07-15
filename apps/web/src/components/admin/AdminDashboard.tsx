"use client";

// components/admin/AdminDashboard.tsx — design-reference F15(관리자) 핸드오프 정렬
// (P13-T6-13). §3.9 이중 밀도: 카드 3개(사용자/세션/오류) — label 12px muted + 값
// 24px mono bold + 실측 보조 지표(프레임의 "+8" 델타는 AdminDashboardSummary 계약에
// 없는 필드라 재현하지 않고, 계약이 실제로 제공하는 24h/7d 보조 수치로 대체). 도구
// 요약은 전용 라우트(/admin/tool-metrics · ToolMetricsTable)로 이어지는 밀도 낮은
// 한 줄 스트립으로 축약.
import React from "react";
import { useAdminDashboard } from "../../hooks/useAdminDashboard";

export function AdminDashboard() {
  const { summary, loading, error } = useAdminDashboard();

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">관리</h2>
        <span className="font-mono text-[11px] text-fg-subtle">/admin</span>
      </div>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : summary ? (
        <>
          <div className="mt-4 flex flex-wrap gap-3.5">
            <div className="w-[220px] rounded-[10px] border border-border p-3.5 px-4">
              <div className="text-xs text-fg-muted">사용자</div>
              <div
                data-testid="admin-stat-users"
                className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg"
              >
                {summary.users.total}
              </div>
              <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                24h 활성 {summary.users.activeLast24h} · 7d 신규{" "}
                {summary.users.newLast7d}
              </div>
            </div>

            <div className="w-[220px] rounded-[10px] border border-border p-3.5 px-4">
              <div className="text-xs text-fg-muted">세션</div>
              <div
                data-testid="admin-stat-sessions"
                className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg"
              >
                {summary.sessions.total}
              </div>
              <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                현재 활성 {summary.sessions.activeNow} · 24h 완료{" "}
                {summary.sessions.completedLast24h}
              </div>
            </div>

            <div className="w-[220px] rounded-[10px] border border-border p-3.5 px-4">
              <div className="text-xs text-fg-muted">24시간 오류</div>
              <div
                data-testid="admin-stat-errors"
                className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg"
              >
                {summary.errors.last24h}
              </div>
              <div className="mt-1 font-mono text-[11px] text-fg-subtle">
                7d {summary.errors.last7d} · critical {summary.errors.critical}
              </div>
            </div>
          </div>

          <div className="mt-3.5 flex items-center gap-4 rounded-md border border-border bg-surface px-4 py-2.5 text-xs text-fg-muted">
            <span className="font-semibold text-fg-muted">도구</span>
            <span className="font-mono tabular-nums">
              24h 호출 {summary.tools.totalCalls24h}
            </span>
            <span className="font-mono tabular-nums">
              에러율 {(summary.tools.errorRate * 100).toFixed(1)}%
            </span>
            <span className="font-mono tabular-nums">
              p50 {summary.tools.p50LatencyMs}ms
            </span>
            <span className="ml-auto font-mono text-fg-subtle">
              /admin/tool-metrics
            </span>
          </div>
        </>
      ) : null}
    </section>
  );
}

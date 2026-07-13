"use client";

// components/admin/ToolMetricsTable.tsx — 18-FRONTEND-WIREFRAMES § /admin/tool-metrics
// 테이블(tool name/count/error rate/p50 latency). 7일 시계열 차트는 acceptance 범위 밖(생략).
import React from "react";
import { useToolMetrics } from "../../hooks/useToolMetrics";

export function ToolMetricsTable() {
  const { metrics, loading, error } = useToolMetrics();

  if (loading) return <p>불러오는 중…</p>;
  if (error) return <p className="text-accent">{error}</p>;
  if (metrics.length === 0)
    return <p className="text-fg-muted">도구 호출 기록이 없습니다.</p>;

  return (
    <table>
      <thead>
        <tr>
          <th>도구</th>
          <th>호출수</th>
          <th>에러율</th>
          <th>p50</th>
          <th>p95</th>
          <th>p99</th>
        </tr>
      </thead>
      <tbody>
        {metrics.map((m) => (
          <tr key={m.toolName}>
            <td>{m.toolName}</td>
            <td>{m.count}</td>
            <td>{(m.errorRate * 100).toFixed(1)}%</td>
            <td>{m.p50DurationMs}</td>
            <td>{m.p95DurationMs}</td>
            <td>{m.p99DurationMs}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

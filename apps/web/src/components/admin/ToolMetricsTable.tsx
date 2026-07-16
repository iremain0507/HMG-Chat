"use client";

// components/admin/ToolMetricsTable.tsx — design-reference F15(관리자) 핸드오프 정렬
// (P13-T6-13). §3.9 이중 밀도(관리자는 스캔이 목적): 행높이 32px·12.5px 타입의 고밀도
// 테이블 + 오류율 임계 초과 시 accent 강조(운영 가시성 → 정책 환류). 프레임의 "출처"·
// "7일 추이" 스파크라인 컬럼은 ToolMetricDto 계약에 해당 필드가 없어 재현하지 않는다
// (신규 필드는 packages/interfaces 확장 없이는 불가 — 이 태스크 범위 밖).
import React from "react";
import { useToolMetrics } from "../../hooks/useToolMetrics";
import { AdminSubNav } from "./AdminSubNav";

const ERROR_RATE_ALERT_THRESHOLD = 0.03;

const TH_CLASS =
  "border-b border-border px-2.5 py-[7px] text-[11.5px] font-semibold text-fg-muted";
const TH_RIGHT_CLASS = `${TH_CLASS} text-right`;

export function ToolMetricsTable() {
  const { metrics, loading, error } = useToolMetrics();

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">도구 지표</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/tool-metrics
        </span>
      </div>

      <AdminSubNav />

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : metrics.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">도구 호출 기록이 없습니다.</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              <th className={`${TH_CLASS} text-left`}>도구</th>
              <th className={TH_RIGHT_CLASS}>호출</th>
              <th className={TH_RIGHT_CLASS}>오류율</th>
              <th className={TH_RIGHT_CLASS}>p50</th>
              <th className={TH_RIGHT_CLASS}>p95</th>
              <th className={TH_RIGHT_CLASS}>p99</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m, i) => {
              const alert = m.errorRate >= ERROR_RATE_ALERT_THRESHOLD;
              const rowBorder =
                i === metrics.length - 1 ? "" : "border-b border-border";
              return (
                <tr key={m.toolName}>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg`}
                  >
                    {m.toolName}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                  >
                    {m.count}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums ${
                      alert ? "text-accent" : "text-fg"
                    }`}
                  >
                    {(m.errorRate * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                  >
                    {m.p50DurationMs}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                  >
                    {m.p95DurationMs}
                  </td>
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                  >
                    {m.p99DurationMs}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

"use client";

// components/admin/ToolMetricsTable.tsx — design-reference F15(관리자) 핸드오프 정렬
// (P13-T6-13). §3.9 이중 밀도(관리자는 스캔이 목적): 행높이 32px·12.5px 타입의 고밀도
// 테이블 + 오류율 임계 초과 시 accent 강조(운영 가시성 → 정책 환류).
// P22-T6-19(C17B): 프레임의 "출처"·"7일 추이" 컬럼을 계약 확장 후 재현했다 —
//   출처는 GET /admin/tool-metrics 의 source(0039 tool_metrics.source 최빈값, 기존 NULL
//   행은 서버가 'builtin' 으로 해석), 추이는 trend(7 포인트 zero-fill)를 인라인 SVG
//   스파크라인으로 그린다. 두 필드 모두 optional 이라 없으면 각각 '내장'·'—' 로 폴백한다.
import React from "react";
import { useToolMetrics, type ToolMetricDto } from "../../hooks/useToolMetrics";
import { AdminSubNav } from "./AdminSubNav";

const ERROR_RATE_ALERT_THRESHOLD = 0.03;

const TH_CLASS =
  "border-b border-border px-2.5 py-[7px] text-[11.5px] font-semibold text-fg-muted";
const TH_RIGHT_CLASS = `${TH_CLASS} text-right`;

// 출처 라벨 — NULL/미지정은 '내장'(하위호환). 알 수 없는 값은 원문 그대로 노출한다.
const SOURCE_LABELS: Record<string, string> = {
  builtin: "내장",
  mcp: "MCP",
  skill: "스킬",
  openapi: "OpenAPI",
};

function sourceLabel(source: string | undefined | null): string {
  if (!source) return "내장";
  return SOURCE_LABELS[source] ?? source;
}

// 스파크라인 — 고밀도 행(32px)에 맞춘 소형. QuotaPanel 의 polyline 패턴 재사용.
const SPARK_WIDTH = 64;
const SPARK_HEIGHT = 18;
const SPARK_PADDING = 2;

function sparklinePoints(trend: NonNullable<ToolMetricDto["trend"]>): string {
  const max = Math.max(...trend.map((p) => p.count), 1);
  const span = trend.length > 1 ? trend.length - 1 : 1;
  const usableHeight = SPARK_HEIGHT - SPARK_PADDING * 2;
  return trend
    .map((point, i) => {
      const x = (i / span) * SPARK_WIDTH;
      const y =
        SPARK_HEIGHT - SPARK_PADDING - (point.count / max) * usableHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function TrendSparkline({ metric }: { metric: ToolMetricDto }) {
  const trend = metric.trend;
  if (!trend || trend.length === 0) {
    return <span className="text-fg-subtle">—</span>;
  }
  const hasErrors = trend.some((p) => p.errorCount > 0);
  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      role="img"
      aria-label={`${metric.toolName} 최근 7일 호출 추이`}
      className="align-middle"
    >
      <line
        x1="0"
        y1={SPARK_HEIGHT - SPARK_PADDING}
        x2={SPARK_WIDTH}
        y2={SPARK_HEIGHT - SPARK_PADDING}
        stroke="var(--color-border)"
        strokeWidth="1"
      />
      <polyline
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="1.5"
        points={sparklinePoints(trend)}
      />
      {hasErrors && (
        <circle
          cx={SPARK_WIDTH - 1.5}
          cy={SPARK_PADDING}
          r="1.5"
          fill="var(--color-accent)"
        />
      )}
    </svg>
  );
}

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
              <th className={`${TH_CLASS} text-left`}>출처</th>
              <th className={TH_RIGHT_CLASS}>호출</th>
              <th className={TH_RIGHT_CLASS}>오류율</th>
              <th className={TH_RIGHT_CLASS}>p50</th>
              <th className={TH_RIGHT_CLASS}>p95</th>
              <th className={TH_RIGHT_CLASS}>p99</th>
              <th className={`${TH_CLASS} text-left`}>7일 추이</th>
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
                    className={`${rowBorder} px-2.5 py-[6px] text-xs text-fg-muted`}
                    data-testid={`tool-metric-source-${m.toolName}`}
                  >
                    {sourceLabel(m.source)}
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
                  <td
                    className={`${rowBorder} px-2.5 py-[6px] text-xs`}
                    data-testid={`tool-metric-trend-${m.toolName}`}
                  >
                    <TrendSparkline metric={m} />
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

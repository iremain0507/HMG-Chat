"use client";

// components/admin/AnalyticsDashboard.tsx — P20-T1-15: OWUI 대비 Analytics 갭.
// 모델별 사용량 랭킹 테이블(ToolMetricsTable 과 동일 고밀도 스타일) + 메시지 타임라인
// 막대 차트(QuotaPanel 의 접근성 SVG 패턴 재사용: role=img + aria-label, 시맨틱 토큰만).
import React from "react";
import { useAdminAnalytics } from "../../hooks/useAdminAnalytics";
import { AdminSubNav } from "./AdminSubNav";

const TH_CLASS =
  "border-b border-border px-2.5 py-[7px] text-[11.5px] font-semibold text-fg-muted";
const TH_RIGHT_CLASS = `${TH_CLASS} text-right`;

const CHART_WIDTH = 480;
const CHART_HEIGHT = 120;
const CHART_BASELINE = CHART_HEIGHT - 16;
const CHART_TOP_PADDING = 8;
const BAR_GAP = 4;

function formatBucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function formatCost(costMicros: number): string {
  return `₩${(costMicros / 1_000_000).toFixed(2)}`;
}

function MessageTimelineChart({
  timeline,
}: {
  timeline: Array<{ bucket: string; count: number }>;
}) {
  const max = Math.max(1, ...timeline.map((b) => b.count));
  const barWidth =
    timeline.length > 0
      ? (CHART_WIDTH - BAR_GAP * (timeline.length - 1)) / timeline.length
      : 0;

  return (
    <svg
      width={CHART_WIDTH}
      height={CHART_HEIGHT}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label="메시지 타임라인 추이"
      className="mt-2"
    >
      <line
        x1="0"
        y1={CHART_BASELINE}
        x2={CHART_WIDTH}
        y2={CHART_BASELINE}
        stroke="var(--color-border)"
        strokeWidth="1"
      />
      {timeline.map((b, i) => {
        const barHeight =
          (b.count / max) * (CHART_BASELINE - CHART_TOP_PADDING);
        const x = i * (barWidth + BAR_GAP);
        const y = CHART_BASELINE - barHeight;
        return (
          <g key={b.bucket}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={barHeight}
              fill="var(--color-primary)"
            >
              <title>{`${formatBucketLabel(b.bucket)}: ${b.count}건`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={CHART_HEIGHT - 4}
              fontSize="9"
              textAnchor="middle"
              fill="var(--color-fg-muted)"
              fontFamily="var(--font-mono)"
            >
              {formatBucketLabel(b.bucket)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AnalyticsDashboard() {
  const { analytics, loading, error } = useAdminAnalytics();
  const hasData =
    !!analytics &&
    (analytics.modelUsage.length > 0 || analytics.timeline.length > 0);

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">사용량 분석</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/analytics
        </span>
      </div>

      <AdminSubNav />

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : !hasData ? (
        <p className="mt-4 text-sm text-fg-muted">표시할 데이터가 없습니다.</p>
      ) : (
        <>
          <div className="mt-6 text-xs font-semibold text-fg-muted">
            메시지 타임라인
          </div>
          {analytics.timeline.length > 0 ? (
            <MessageTimelineChart timeline={analytics.timeline} />
          ) : (
            <p className="mt-2 text-sm text-fg-muted">
              선택한 기간에 메시지가 없습니다.
            </p>
          )}

          <div className="mt-6 text-xs font-semibold text-fg-muted">
            모델별 사용량
          </div>
          {analytics.modelUsage.length === 0 ? (
            <p className="mt-2 text-sm text-fg-muted">
              선택한 기간에 사용 기록이 없습니다.
            </p>
          ) : (
            <table className="mt-2 w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={`${TH_CLASS} text-left`}>모델</th>
                  <th className={TH_RIGHT_CLASS}>메시지</th>
                  <th className={TH_RIGHT_CLASS}>입력 토큰</th>
                  <th className={TH_RIGHT_CLASS}>출력 토큰</th>
                  <th className={TH_RIGHT_CLASS}>비용</th>
                </tr>
              </thead>
              <tbody>
                {analytics.modelUsage.map((m, i) => {
                  const rowBorder =
                    i === analytics.modelUsage.length - 1
                      ? ""
                      : "border-b border-border";
                  return (
                    <tr key={m.model}>
                      <td
                        className={`${rowBorder} px-2.5 py-[6px] font-mono text-xs text-fg`}
                      >
                        {m.model}
                      </td>
                      <td
                        className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                      >
                        {m.messages}
                      </td>
                      <td
                        className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                      >
                        {m.tokensIn}
                      </td>
                      <td
                        className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                      >
                        {m.tokensOut}
                      </td>
                      <td
                        className={`${rowBorder} px-2.5 py-[6px] text-right font-mono text-xs tabular-nums text-fg`}
                      >
                        {formatCost(m.costMicros)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

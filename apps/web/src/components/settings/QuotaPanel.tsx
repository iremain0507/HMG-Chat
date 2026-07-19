"use client";

// components/settings/QuotaPanel.tsx — design-reference F14(사용량/쿼터) 핸드오프
// 정렬(P13-T6-12): 예산 mono 헤드라인 + 진행바(80%는 UI 상 경고 지점을 보여주는 프레임
// 고정값 — quota-service.ts 의 서버 차단 임계(QUOTA_WARNING_RATIO=0.9)와는 별개) +
// 최근 30일 일별 사용액 라인차트 + 모델별 비용 표. useQuota 의 실 데이터만 사용 —
// /usage/me 계약(16-API-CONTRACT §12)이 계약단위 C17(A)/P22-T6-19 에서 byModel(모델별
// tokensIn/tokensOut/costMicros, costMicros 내림차순)을 함께 반환하도록 확장돼, "모델별 비용"
// 표는 이제 실 데이터로 렌더링한다. byModel 이 비면(구버전 응답/사용 내역 없음) 표는 생략한다.
import React from "react";
import { useQuota } from "../../hooks/useQuota";

const WARNING_THRESHOLD = 0.8;

function formatWon(micros: number): string {
  const won = Math.round(micros / 1_000_000);
  return `₩${won.toLocaleString("ko-KR")}`;
}

const CHART_WIDTH = 680; // preview 갤러리 컨테이너(max-w-3xl - padding) 내 클리핑 방지 여유폭.
const CHART_HEIGHT = 150;
const CHART_BASELINE = 130;
const CHART_TOP = 10;
const CHART_RIGHT_MARGIN = 48; // 마지막 지점 mono 라벨(₩N,NNN)이 잘리지 않도록 여백 확보.
const CHART_PLOT_WIDTH = CHART_WIDTH - CHART_RIGHT_MARGIN;

export function QuotaPanel() {
  const { quota, daily, byModel, loading, error } = useQuota();

  const byModelTotalMicros = byModel.reduce((sum, m) => sum + m.costMicros, 0);

  const percent = quota
    ? Math.min(100, Math.round((quota.usedMicros / quota.budgetMicros) * 100))
    : 0;

  const points = daily.map((d, i) => {
    const max = Math.max(1, ...daily.map((e) => e.costMicros));
    const x =
      daily.length > 1 ? (i / (daily.length - 1)) * CHART_PLOT_WIDTH : 0;
    const y =
      CHART_BASELINE - (d.costMicros / max) * (CHART_BASELINE - CHART_TOP);
    return { x, y, entry: d };
  });
  const lastPoint = points[points.length - 1];

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">사용량</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/quota
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : quota ? (
        <div className="mt-4 flex flex-wrap items-start gap-8">
          <div className="max-w-[720px] flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-[13px] text-fg-muted">이번 달</span>
              <span
                data-testid="quota-used-amount"
                className="font-mono text-[22px] font-semibold tabular-nums text-fg"
              >
                {formatWon(quota.usedMicros)}
              </span>
              <span className="font-mono text-[13px] text-placeholder">
                / {formatWon(quota.budgetMicros)} ({percent}%)
              </span>
            </div>

            <div className="relative mt-2.5 h-2 rounded-full bg-surface-2">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${percent}%` }}
              />
              <span
                data-testid="quota-threshold-marker"
                aria-hidden="true"
                className="absolute top-[-4px] h-4 w-px bg-warning"
                style={{ left: `${WARNING_THRESHOLD * 100}%` }}
              />
              <span
                aria-hidden="true"
                className="absolute top-[-22px] -translate-x-1/2 text-[10.5px] text-warning-fg"
                style={{ left: `${WARNING_THRESHOLD * 100}%` }}
              >
                80% 알림
              </span>
            </div>
            <p className="mt-2 text-xs text-placeholder">
              예산 80% 도달 시 알림 · 100% 도달 시 신규 요청 차단(진행 중 작업은
              완료)
            </p>

            <div className="mt-6 text-xs font-semibold text-placeholder">
              최근 30일 일별 사용액
            </div>
            {points.length > 1 ? (
              <svg
                width={CHART_WIDTH}
                height={CHART_HEIGHT}
                viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                role="img"
                aria-label="최근 30일 일별 사용액 추이"
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
                <polyline
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="2"
                  points={points.map((p) => `${p.x},${p.y}`).join(" ")}
                />
                {lastPoint && (
                  <>
                    <circle
                      cx={lastPoint.x}
                      cy={lastPoint.y}
                      r="3.5"
                      fill="var(--color-primary)"
                    />
                    <text
                      x={Math.min(lastPoint.x + 4, CHART_WIDTH - 60)}
                      y={Math.max(lastPoint.y - 6, 10)}
                      fontSize="10"
                      fill="var(--color-primary)"
                      fontFamily="var(--font-mono)"
                    >
                      {formatWon(lastPoint.entry.costMicros)}
                    </text>
                  </>
                )}
              </svg>
            ) : (
              <p className="mt-2 text-sm text-fg-muted">
                최근 사용 내역이 없습니다.
              </p>
            )}
          </div>

          <div className="w-full max-w-[380px]">
            <div className="mb-2 text-xs font-semibold text-placeholder">
              합계
            </div>
            <table className="w-full border-collapse text-[13px]">
              <tbody>
                <tr>
                  <td className="border-b border-surface-2 py-2">
                    이번 달 사용액
                  </td>
                  <td className="border-b border-surface-2 py-2 text-right font-mono text-xs">
                    {formatWon(quota.usedMicros)}
                  </td>
                  <td className="border-b border-surface-2 py-2 text-right font-mono text-[11px] text-placeholder">
                    {percent}%
                  </td>
                </tr>
              </tbody>
            </table>
            {byModel.length > 0 && (
              <>
                <div className="mt-5 mb-2 text-xs font-semibold text-placeholder">
                  모델별 비용
                </div>
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only">
                    이번 달 모델별 사용 비용
                  </caption>
                  <tbody>
                    {byModel.map((m) => (
                      <tr key={m.model} data-testid="quota-by-model-row">
                        <td className="border-b border-surface-2 py-2 font-mono text-xs">
                          {m.model}
                        </td>
                        <td className="border-b border-surface-2 py-2 text-right font-mono text-xs">
                          {formatWon(m.costMicros)}
                        </td>
                        <td className="border-b border-surface-2 py-2 text-right font-mono text-[11px] text-placeholder">
                          {byModelTotalMicros > 0
                            ? Math.round(
                                (m.costMicros / byModelTotalMicros) * 100,
                              )
                            : 0}
                          %
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 text-fg-muted">합계</td>
                      <td
                        data-testid="quota-by-model-total"
                        className="py-2 text-right font-mono text-xs font-semibold text-fg"
                      >
                        {formatWon(byModelTotalMicros)}
                      </td>
                      <td className="py-2" />
                    </tr>
                  </tbody>
                </table>
              </>
            )}

            <div className="mt-3.5 rounded-[10px] border border-warning bg-warning-soft p-2.5 px-3.5 text-xs leading-relaxed text-warning-fg">
              크레딧 소진 시: 재시도 없이 &quot;관리자에게 증액 요청&quot; 안내
              — 무의미한 재시도 버튼을 주지 않는다
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

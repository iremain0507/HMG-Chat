// @vitest-environment jsdom
// components/settings/QuotaPanel.tsx — design-reference F14(사용량/쿼터) 핸드오프
// 정렬(P13-T6-12): 예산/사용액 mono 헤드라인 + 진행바(80% 임계선 마커) + 최근 30일 라인차트.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QuotaPanel } from "../QuotaPanel";

const QUOTA = {
  budgetMicros: 300_000_000_000,
  usedMicros: 141_000_000_000,
  periodEnd: "2026-07-31T00:00:00Z",
};

const DAILY = [
  { date: "2026-07-14", tokensIn: 100, tokensOut: 50, costMicros: 8_000_000 },
  { date: "2026-07-15", tokensIn: 120, tokensOut: 60, costMicros: 8_200_000 },
];

const BY_MODEL = [
  {
    model: "claude-opus-4-6",
    tokensIn: 1200,
    tokensOut: 600,
    costMicros: 120_000_000_000,
  },
  {
    model: "claude-haiku-4-6",
    tokensIn: 400,
    tokensOut: 200,
    costMicros: 21_000_000_000,
  },
];

function stubUsageFetch(usageBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/v1/quota")) {
        return { ok: true, json: async () => ({ data: QUOTA }) };
      }
      return { ok: true, json: async () => usageBody };
    }),
  );
}

describe("QuotaPanel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("예산 대비 사용액과 80% 임계선을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/quota")) {
          return { ok: true, json: async () => ({ data: QUOTA }) };
        }
        return { ok: true, json: async () => ({ data: DAILY }) };
      }),
    );

    render(<QuotaPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("quota-used-amount")).toHaveTextContent(
        "₩141,000",
      );
    });
    expect(screen.getByText(/₩300,000/)).toBeInTheDocument();
    expect(screen.getAllByText(/47%/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("quota-threshold-marker")).toBeInTheDocument();
    expect(
      screen.getByText(
        "예산 80% 도달 시 알림 · 100% 도달 시 신규 요청 차단(진행 중 작업은 완료)",
      ),
    ).toBeInTheDocument();
  });

  it("일별 사용량 데이터가 있으면 추이 차트를 렌더링한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("/api/v1/quota")) {
          return { ok: true, json: async () => ({ data: QUOTA }) };
        }
        return { ok: true, json: async () => ({ data: DAILY }) };
      }),
    );

    render(<QuotaPanel />);

    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: "최근 30일 일별 사용액 추이" }),
      ).toBeInTheDocument();
    });
  });

  it("byModel 이 있으면 모델별 비용 표를 렌더링하고 합계가 월 총액과 같다", async () => {
    stubUsageFetch({ data: DAILY, byModel: BY_MODEL });

    render(<QuotaPanel />);

    await waitFor(() => {
      expect(screen.getByText("모델별 비용")).toBeInTheDocument();
    });

    const rows = screen.getAllByTestId("quota-by-model-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("claude-opus-4-6");
    expect(rows[0]).toHaveTextContent("₩120,000");
    expect(rows[1]).toHaveTextContent("claude-haiku-4-6");
    expect(rows[1]).toHaveTextContent("₩21,000");

    // 수용 기준: 모델별 비용 합 === 이번 달 총액(₩141,000).
    expect(screen.getByTestId("quota-by-model-total")).toHaveTextContent(
      "₩141,000",
    );
  });

  it("byModel 이 비어 있으면 모델별 비용 표를 렌더링하지 않는다", async () => {
    stubUsageFetch({ data: DAILY });

    render(<QuotaPanel />);

    await waitFor(() => {
      expect(screen.getByTestId("quota-used-amount")).toBeInTheDocument();
    });
    expect(screen.queryByText("모델별 비용")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("quota-by-model-row")).toHaveLength(0);
  });

  it("에러 시 에러 메시지를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    );

    render(<QuotaPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("사용량 정보를 불러오지 못했습니다."),
      ).toBeInTheDocument();
    });
  });
});

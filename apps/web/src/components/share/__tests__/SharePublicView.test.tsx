// @vitest-environment jsdom
// components/share/SharePublicView.tsx — 18-FRONTEND-WIREFRAMES § 18.5.5 /share/[token].
// 익명 조회: 정상/만료(410)/취소(410)/존재하지 않음(404) 4 상태 렌더.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockNotFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
vi.mock("next/navigation", () => ({ notFound: mockNotFound }));

import { SharePublicView } from "../SharePublicView";

class NotFoundTestBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  override state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override render() {
    return this.state.hasError ? null : this.props.children;
  }
}

function renderWithBoundary(ui: React.ReactElement) {
  return render(<NotFoundTestBoundary>{ui}</NotFoundTestBoundary>);
}

describe("SharePublicView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockNotFound.mockClear();
  });

  it("정상 토큰이면 파일명과 다운로드 링크를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            token: "tok-1",
            artifactId: "art-1",
            filename: "분석_보고서_v3.pdf",
            type: "pdf",
            sizeBytes: 2400,
            mimeType: "application/pdf",
            expiresAt: "2026-08-01T00:00:00Z",
            viewCount: 0,
            revokedAt: null,
          },
        }),
      })),
    );

    render(<SharePublicView token="tok-1" />);

    await waitFor(() => {
      expect(screen.getByText("분석_보고서_v3.pdf")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "다운로드" })).toHaveAttribute(
      "href",
      "/api/v1/share/tok-1/content",
    );
  });

  it("만료된 토큰(410) 클릭 시 410 안내를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 410, json: async () => ({}) })),
    );

    render(<SharePublicView token="expired" />);

    await waitFor(() => {
      expect(screen.getByText("410")).toBeInTheDocument();
    });
    expect(
      screen.getByText("이 링크는 만료되었거나 취소되었습니다."),
    ).toBeInTheDocument();
  });

  it("존재하지 않는 토큰(404) 이면 notFound() 를 호출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    expect(() =>
      renderWithBoundary(<SharePublicView token="missing" />),
    ).not.toThrow();

    await waitFor(() => {
      expect(mockNotFound).toHaveBeenCalled();
    });
  });
});

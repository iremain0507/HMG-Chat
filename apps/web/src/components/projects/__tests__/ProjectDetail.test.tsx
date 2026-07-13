// @vitest-environment jsdom
// components/projects/ProjectDetail.tsx — 18-FRONTEND-WIREFRAMES § 18.5.3 /projects/[projectId]
// 의 Phase 3 범위 최소 구현: 프로젝트 기본 정보 표시 + existence-leak 방지(404).
// 문서/멤버/세션 목록(§ 18.5.3 와이어프레임 나머지)은 Phase 4/5 소관이라 범위 밖.
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

import { ProjectDetail } from "../ProjectDetail";

// notFound() 는 Next.js App Router 가 각 세그먼트에 자동 주입하는 NotFoundBoundary 가
// 캐치하는 것을 전제로 렌더 중 throw 한다 — 그 boundary 없이 단위 테스트에서 직접 렌더하면
// React 가 unhandled error 로 취급해 테스트 프로세스를 실패시키므로, 실제 런타임의
// boundary 역할을 이 로컬 boundary 로 대신한다.
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

describe("ProjectDetail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockNotFound.mockClear();
  });

  it("프로젝트를 정상 조회하면 이름/visibility 를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "proj-1",
            name: "영업 RFP 분석",
            description: null,
            visibility: "private",
            orgUnitId: null,
            ownerId: "user-1",
            createdAt: "2026-04-01T00:00:00Z",
          },
        }),
      })),
    );

    render(<ProjectDetail projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText("영업 RFP 분석")).toBeInTheDocument();
    });
  });

  it("다른 org 의 private 프로젝트 조회 시도 → notFound() 호출(404, existence leak 방지)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    expect(() =>
      renderWithBoundary(<ProjectDetail projectId="other-org-private" />),
    ).not.toThrow();

    await waitFor(() => {
      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  it("visibility=team 인 프로젝트를 다른 org 에서 조회해도(서버 404) 동일하게 notFound() 를 호출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    renderWithBoundary(<ProjectDetail projectId="other-org-team" />);

    await waitFor(() => {
      expect(mockNotFound).toHaveBeenCalled();
    });
  });
});

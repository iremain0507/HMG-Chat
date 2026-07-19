// @vitest-environment jsdom
// components/share/ConversationSharePublicView.tsx — P20-T1-08
// GET /api/v1/conversation-shares/:token 소비. 익명 조회: 정상/만료(410)/취소(410)/존재하지
// 않음(404) 4 상태 렌더.
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

import { ConversationSharePublicView } from "../ConversationSharePublicView";

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

describe("ConversationSharePublicView", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    mockNotFound.mockClear();
  });

  it("정상 토큰이면 제목과 메시지 목록을 렌더한다(문자열이 아닌 content 는 JSON 문자열로)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            token: "tok-1",
            sessionId: "session-1",
            title: "분석 대화",
            capturedAt: "2026-07-17T00:00:00.000Z",
            messages: [
              {
                id: "m1",
                role: "user",
                content: "요약해줘",
                createdAt: "2026-07-17T00:00:00.000Z",
              },
              {
                id: "m2",
                role: "assistant",
                content: [{ type: "text", text: "요약 결과입니다" }],
                createdAt: "2026-07-17T00:01:00.000Z",
              },
            ],
            revokedAt: null,
          },
        }),
      })),
    );

    render(<ConversationSharePublicView token="tok-1" />);

    await waitFor(() => {
      expect(screen.getByText("분석 대화")).toBeInTheDocument();
    });
    expect(screen.getByText("요약해줘")).toBeInTheDocument();
    expect(screen.getByText("사용자")).toBeInTheDocument();
    expect(screen.getByText("어시스턴트")).toBeInTheDocument();
    expect(screen.getByText(/요약 결과입니다/)).toBeInTheDocument();
    expect(
      screen.getByText(/2026-07-17 에 생성되었습니다/),
    ).toBeInTheDocument();
  });

  it("만료/취소된 토큰(410) 이면 410 안내를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 410, json: async () => ({}) })),
    );

    render(<ConversationSharePublicView token="expired" />);

    await waitFor(() => {
      expect(screen.getByText("410")).toBeInTheDocument();
    });
    expect(
      screen.getByText("이 링크는 만료되었거나 취소되었습니다."),
    ).toBeInTheDocument();
  });

  it("만료(reason='expired') 이면 만료 전용 안내를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 410,
        json: async () => ({ error: { reason: "expired" } }),
      })),
    );

    render(<ConversationSharePublicView token="expired" />);

    await waitFor(() => {
      expect(screen.getByText("이 링크는 만료되었습니다.")).toBeInTheDocument();
    });
  });

  it("취소(reason='revoked') 이면 취소 전용 안내와 구분되는 아이콘을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 410,
        json: async () => ({ error: { reason: "revoked" } }),
      })),
    );

    render(<ConversationSharePublicView token="revoked" />);

    await waitFor(() => {
      expect(screen.getByText("이 링크는 취소되었습니다.")).toBeInTheDocument();
    });
    expect(screen.getByTestId("share-gone-revoked")).toBeInTheDocument();
  });

  it("존재하지 않는 토큰(404) 이면 notFound() 를 호출한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    expect(() =>
      renderWithBoundary(<ConversationSharePublicView token="missing" />),
    ).not.toThrow();

    await waitFor(() => {
      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  it("기타 오류 응답이면 오류 메시지를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: "서버 오류" } }),
      })),
    );

    render(<ConversationSharePublicView token="boom" />);

    await waitFor(() => {
      expect(screen.getByText("서버 오류")).toBeInTheDocument();
    });
  });
});

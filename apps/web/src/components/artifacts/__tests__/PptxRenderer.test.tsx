// @vitest-environment jsdom
// components/artifacts/PptxRenderer.tsx — 18-FRONTEND-WIREFRAMES § artifacts.
// PPTX 는 브라우저가 직접 렌더 불가 — contentUrl 이 이미 변환된 PDF byte 를 서빙한다는
// 전제(L17, office-pdf-converter/converter-worker 는 server 측이 호출) 하에 blob 을 받아
// PdfRenderer 에 위임하는지만 검증한다. dev 환경에선 이 응답이 mock 변환 결과다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../PdfRenderer", () => ({
  PdfRenderer: ({ url }: { url: string }) => (
    <div data-testid="pdf-renderer">{url}</div>
  ),
}));

import { PptxRenderer } from "../PptxRenderer";

describe("PptxRenderer", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("변환된 콘텐츠를 fetch 해 PdfRenderer 로 위임한다", async () => {
    const blob = new Blob(["pdf-bytes"], { type: "application/pdf" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, blob: async () => blob })),
    );
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:mock-url"),
      revokeObjectURL: vi.fn(),
    });

    render(<PptxRenderer contentUrl="/api/v1/artifacts/a1/content" />);

    expect(screen.getByText("변환 중…")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("pdf-renderer")).toHaveTextContent(
        "blob:mock-url",
      );
    });
  });

  it("변환 실패 시 에러 메시지를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );

    render(<PptxRenderer contentUrl="/api/v1/artifacts/a1/content" />);

    await waitFor(() => {
      expect(
        screen.getByText("PPTX 미리보기 변환에 실패했습니다."),
      ).toBeInTheDocument();
    });
  });
});

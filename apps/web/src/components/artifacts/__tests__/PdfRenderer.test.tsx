// @vitest-environment jsdom
// components/artifacts/PdfRenderer.tsx — 18-FRONTEND-WIREFRAMES § artifacts.
// react-pdf 는 jsdom 에 canvas/worker 가 없어 실렌더가 불가하므로 모듈을 모킹해
// PdfRenderer 가 Document/Page 에 올바른 props(file, pageNumber) 를 넘기고
// 로딩/에러/페이지 수 표시를 올바르게 처리하는지만 검증한다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-pdf", () => ({
  pdfjs: { GlobalWorkerOptions: {}, version: "4.5.136" },
  Document: ({
    file,
    onLoadSuccess,
    onLoadError,
    children,
  }: {
    file: string;
    onLoadSuccess?: (doc: { numPages: number }) => void;
    onLoadError?: () => void;
    children: React.ReactNode;
  }) => {
    if (file === "bad.pdf") {
      onLoadError?.();
      return <div data-testid="pdf-document" />;
    }
    onLoadSuccess?.({ numPages: 3 });
    return <div data-testid="pdf-document">{children}</div>;
  },
  Page: ({ pageNumber }: { pageNumber: number }) => (
    <div data-testid={`pdf-page-${pageNumber}`} />
  ),
}));

import { PdfRenderer } from "../PdfRenderer";

describe("PdfRenderer", () => {
  afterEach(() => {
    cleanup();
  });

  it("PDF 첫 페이지와 전체 페이지 수를 표시한다", async () => {
    render(<PdfRenderer url="good.pdf" />);

    expect(screen.getByTestId("pdf-page-1")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("1 / 3 페이지")).toBeInTheDocument();
    });
  });

  it("로드 실패 시 에러 메시지를 표시한다", async () => {
    render(<PdfRenderer url="bad.pdf" />);

    await waitFor(() => {
      expect(
        screen.getByText("PDF를 불러오지 못했습니다."),
      ).toBeInTheDocument();
    });
  });
});

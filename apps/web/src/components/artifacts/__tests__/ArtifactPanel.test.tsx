// @vitest-environment jsdom
// components/artifacts/ArtifactPanel.tsx — 18-FRONTEND-WIREFRAMES § artifacts "우측 패널".
// type 에 따라 PdfRenderer/PptxRenderer 로 위임하는지, 미지원 타입은 다운로드 fallback 을
// 보여주는지 검증한다 (acceptance: ArtifactPanel.test.tsx preview 렌더).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("../PdfRenderer", () => ({
  PdfRenderer: ({ url }: { url: string }) => (
    <div data-testid="pdf-renderer">{url}</div>
  ),
}));
vi.mock("../PptxRenderer", () => ({
  PptxRenderer: ({ contentUrl }: { contentUrl: string }) => (
    <div data-testid="pptx-renderer">{contentUrl}</div>
  ),
}));
vi.mock("../../chat/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => (
    <div data-testid="md">{children}</div>
  ),
}));
vi.mock("../../../lib/fetch-with-refresh", () => ({ apiFetch: vi.fn() }));

import { ArtifactPanel, type ArtifactDto } from "../ArtifactPanel";
import { apiFetch } from "../../../lib/fetch-with-refresh";

function makeArtifact(overrides: Partial<ArtifactDto> = {}): ArtifactDto {
  return {
    id: "artifact-1",
    type: "pdf",
    filename: "report.pdf",
    sizeBytes: 10_000_000,
    storageKind: "s3",
    downloadUrl: null,
    createdAt: "2026-07-13T00:00:00Z",
    ...overrides,
  };
}

describe("ArtifactPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("파일명과 다운로드 링크를 표시한다", () => {
    render(<ArtifactPanel artifact={makeArtifact()} />);
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("다운로드")).toHaveAttribute(
      "href",
      "/api/v1/artifacts/artifact-1/content",
    );
  });

  it("pdf artifact 는 PdfRenderer 로 미리보기를 렌더한다", () => {
    render(<ArtifactPanel artifact={makeArtifact({ type: "pdf" })} />);
    expect(screen.getByTestId("pdf-renderer")).toHaveTextContent(
      "/api/v1/artifacts/artifact-1/content",
    );
  });

  it("pptx artifact(10MB) 는 PptxRenderer 로 미리보기를 렌더한다", () => {
    render(
      <ArtifactPanel
        artifact={makeArtifact({
          id: "artifact-2",
          type: "pptx",
          filename: "deck.pptx",
          sizeBytes: 10 * 1024 * 1024,
        })}
      />,
    );
    expect(screen.getByTestId("pptx-renderer")).toHaveTextContent(
      "/api/v1/artifacts/artifact-2/content",
    );
  });

  it("미지원 타입은 미리보기 대신 안내 문구를 표시한다", () => {
    render(<ArtifactPanel artifact={makeArtifact({ type: "xlsx" })} />);
    expect(
      screen.getByText("이 형식은 미리보기를 지원하지 않습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("pdf-renderer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pptx-renderer")).not.toBeInTheDocument();
  });

  it("markdown artifact 는 콘텐츠를 fetch 해 Markdown 으로 미리보기한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      text: () => Promise.resolve("# 데이터레이크 구축 가이드\n\n본문"),
    } as unknown as Response);
    render(
      <ArtifactPanel
        artifact={makeArtifact({ type: "markdown", filename: "guide.md" })}
      />,
    );
    const md = await screen.findByTestId("md");
    expect(md).toHaveTextContent("데이터레이크 구축 가이드");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/artifacts/artifact-1/content",
    );
    expect(
      screen.queryByText("이 형식은 미리보기를 지원하지 않습니다."),
    ).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom
// components/artifacts/ArtifactCanvas.tsx — 19-UIUX-UPGRADE.md § P10-T6-10.
// artifact_created 로 채워지는 artifacts 목록을 받아 우측 패널로 렌더 —
// 미리보기/코드 토글, 버전 페이저(‹N/M›), 공유/다운로드, 닫기 동작을 검증한다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("../ArtifactPanel", () => ({
  ArtifactPanel: ({ artifact }: { artifact: { filename: string } }) => (
    <div data-testid="artifact-panel-preview">{artifact.filename}</div>
  ),
}));

vi.mock("../ShareDialog", () => ({
  ShareDialog: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="공유">
      <button type="button" onClick={onClose}>
        닫기
      </button>
    </div>
  ),
}));

import { ArtifactCanvas, type ArtifactCanvasArtifact } from "../ArtifactCanvas";

function makeArtifacts(): ArtifactCanvasArtifact[] {
  return [
    {
      artifactId: "artifact-1",
      artifactKind: "markdown",
      filename: "report-v1.md",
      sizeBytes: 100,
    },
    {
      artifactId: "artifact-2",
      artifactKind: "markdown",
      filename: "report-v2.md",
      sizeBytes: 200,
    },
  ];
}

describe("ArtifactCanvas", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("활성 artifact 의 파일명과 미리보기를 렌더하고, 닫기 버튼이 onClose 를 호출한다", () => {
    const onClose = vi.fn();
    render(
      <ArtifactCanvas
        artifacts={makeArtifacts()}
        activeIndex={1}
        onActiveIndexChange={vi.fn()}
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId("artifact-panel")).toBeInTheDocument();
    expect(screen.getAllByText("report-v2.md").length).toBeGreaterThan(0);
    expect(screen.getByTestId("artifact-panel-preview")).toHaveTextContent(
      "report-v2.md",
    );

    fireEvent.click(screen.getByRole("button", { name: "아티팩트 패널 닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("코드 탭을 클릭하면 원본 콘텐츠를 fetch 해 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "# report v2\ncontent",
      })),
    );

    render(
      <ArtifactCanvas
        artifacts={makeArtifacts()}
        activeIndex={1}
        onActiveIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("artifact-code-view")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "코드" }));

    await waitFor(() => {
      expect(screen.getByTestId("artifact-code-view")).toHaveTextContent(
        "# report v2",
      );
    });
    // apiFetch(만료 시 자동 refresh 래퍼)로 감싸며 항상 credentials:"include" 를 부여한다.
    expect(fetch).toHaveBeenCalledWith("/api/v1/artifacts/artifact-2/content", {
      credentials: "include",
    });
  });

  it("버전 페이저로 이전/다음 artifact 를 탐색하고 경계에서 버튼이 비활성화된다", () => {
    const onActiveIndexChange = vi.fn();
    const { rerender } = render(
      <ArtifactCanvas
        artifacts={makeArtifacts()}
        activeIndex={1}
        onActiveIndexChange={onActiveIndexChange}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId("artifact-version-pager")).toHaveTextContent(
      "2 / 2",
    );
    expect(screen.getByRole("button", { name: "다음 버전" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "이전 버전" }));
    expect(onActiveIndexChange).toHaveBeenCalledWith(0);

    rerender(
      <ArtifactCanvas
        artifacts={makeArtifacts()}
        activeIndex={0}
        onActiveIndexChange={onActiveIndexChange}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("artifact-version-pager")).toHaveTextContent(
      "1 / 2",
    );
    expect(screen.getByRole("button", { name: "이전 버전" })).toBeDisabled();
  });

  it("공유 버튼을 클릭하면 ShareDialog 가 열린다", () => {
    render(
      <ArtifactCanvas
        artifacts={makeArtifacts()}
        activeIndex={0}
        onActiveIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("dialog", { name: "공유" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공유" }));
    expect(screen.getByRole("dialog", { name: "공유" })).toBeInTheDocument();
  });

  it("artifacts 가 비어있으면 아무것도 렌더하지 않는다", () => {
    const { container } = render(
      <ArtifactCanvas
        artifacts={[]}
        activeIndex={0}
        onActiveIndexChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

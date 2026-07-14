// @vitest-environment jsdom
// components/chat/ShareExportMenu.tsx — P10-T6-16 공유/내보내기.
//   내보내기(md/JSON, downloadTextFile 트리거)는 즉시 실행, 공유는 opt-in 확인 후에만
//   기존 ShareDialog(POST/DELETE /artifacts/:id/share)를 연다.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { downloadTextFile } = vi.hoisted(() => ({
  downloadTextFile: vi.fn(),
}));
vi.mock("../../../lib/export-conversation", async () => {
  const actual = await vi.importActual<
    typeof import("../../../lib/export-conversation")
  >("../../../lib/export-conversation");
  return { ...actual, downloadTextFile };
});

import { ShareExportMenu } from "../ShareExportMenu";

const MESSAGES = [
  { role: "user" as const, content: "안녕하세요" },
  { role: "assistant" as const, content: "안녕하세요! 무엇을 도와드릴까요?" },
];

describe("ShareExportMenu", () => {
  afterEach(() => {
    cleanup();
    downloadTextFile.mockClear();
  });

  it("트리거 클릭 시 메뉴가 열린다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(screen.getByTestId("share-export-menu")).toBeInTheDocument();
  });

  it("마크다운으로 내보내기를 누르면 downloadTextFile 이 .md 로 호출된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(
      screen.getByRole("button", { name: "마크다운으로 내보내기" }),
    );
    expect(downloadTextFile).toHaveBeenCalledWith(
      "테스트 대화.md",
      expect.stringContaining("### User"),
      "text/markdown",
    );
    expect(screen.queryByTestId("share-export-menu")).not.toBeInTheDocument();
  });

  it("JSON으로 내보내기를 누르면 downloadTextFile 이 .json 으로 호출된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "JSON으로 내보내기" }));
    expect(downloadTextFile).toHaveBeenCalledWith(
      "테스트 대화.json",
      expect.stringContaining('"messages"'),
      "application/json",
    );
  });

  it("세션에 아티팩트가 없으면 대화 공유 버튼이 비활성화된다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    expect(screen.getByRole("button", { name: "대화 공유" })).toBeDisabled();
  });

  it("대화 공유 클릭 시 opt-in 확인 문구가 먼저 뜨고, 확인 전엔 공유 다이얼로그가 뜨지 않는다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));

    expect(screen.getByTestId("share-confirm")).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "공유" }),
    ).not.toBeInTheDocument();
  });

  it("opt-in 확인에서 취소하면 공유 다이얼로그가 열리지 않는다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
          {
            artifactId: "artifact-1",
            artifactKind: "markdown",
            filename: "report.md",
            sizeBytes: 100,
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.queryByTestId("share-confirm")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "공유" }),
    ).not.toBeInTheDocument();
  });

  it("opt-in 확인에서 공유를 누르면 기존 ShareDialog 가 최신 아티팩트로 열린다", () => {
    render(
      <ShareExportMenu
        title="테스트 대화"
        messages={MESSAGES}
        artifacts={[
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
        ]}
      />,
    );
    fireEvent.click(screen.getByTestId("share-export-trigger"));
    fireEvent.click(screen.getByRole("button", { name: "대화 공유" }));
    fireEvent.click(screen.getByTestId("share-confirm-accept"));

    expect(
      screen.getByRole("dialog", { name: "공유" }),
    ).toBeInTheDocument();
  });
});

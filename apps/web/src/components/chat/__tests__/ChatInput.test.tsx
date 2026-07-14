// @vitest-environment jsdom
// components/chat/ChatInput.tsx — P10-T6-11 컴포저 첨부.
//   📎 버튼/드래그드롭(하이라이트)/이미지 붙여넣기 → useAttachments 업로드 → 제거가능 칩,
//   전송 시 onSend(content, attachments) 로 uploadId 목록을 전달한다.
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
import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function stubUploadFetch(uploadId = "upload-1", filename = "notes.md") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          data: { id: uploadId, filename, mimeType: "text/markdown" },
        }),
      })),
    );
  }

  it("드롭존에 파일을 드롭하면 업로드 후 첨부 칩이 렌더된다", async () => {
    stubUploadFetch();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const dropzone = screen.getByTestId("composer-dropzone");
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });
  });

  it("드래그 오버 중에는 드롭존이 하이라이트 상태를 표시하고 leave 시 해제된다", () => {
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    const dropzone = screen.getByTestId("composer-dropzone");
    expect(dropzone).toHaveAttribute("data-drag-active", "false");

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveAttribute("data-drag-active", "true");

    fireEvent.dragLeave(dropzone);
    expect(dropzone).toHaveAttribute("data-drag-active", "false");
  });

  it("텍스트 입력창에 이미지를 붙여넣으면 업로드되어 칩이 추가된다", async () => {
    stubUploadFetch("upload-2", "screenshot.png");
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const textarea = screen.getByLabelText("메시지 입력");
    const file = new File(["binary"], "screenshot.png", {
      type: "image/png",
    });
    fireEvent.paste(textarea, {
      clipboardData: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
      },
    });

    await waitFor(() => {
      expect(screen.getByText("screenshot.png")).toBeInTheDocument();
    });
  });

  it("첨부 칩의 제거 버튼을 클릭하면 칩이 사라진다", async () => {
    stubUploadFetch();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const dropzone = screen.getByTestId("composer-dropzone");
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("notes.md")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("notes.md 제거"));
    expect(screen.queryByText("notes.md")).not.toBeInTheDocument();
  });

  it("전송 시 완료된 첨부의 uploadId 목록을 onSend 로 전달한다", async () => {
    stubUploadFetch("upload-3", "spec.pdf");
    const onSend = vi.fn();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );

    const dropzone = screen.getByTestId("composer-dropzone");
    const file = new File(["hello"], "spec.pdf", {
      type: "application/pdf",
    });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("spec.pdf")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "이 파일 요약해줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith("이 파일 요약해줘", [
        { uploadId: "upload-3" },
      ]);
    });
  });

  it("업로드가 진행 중이면 전송 버튼이 비활성화된다", async () => {
    let resolveUpload: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveUpload = () =>
              resolve({
                ok: true,
                status: 201,
                json: async () => ({
                  data: {
                    id: "upload-4",
                    filename: "slow.pdf",
                    mimeType: "application/pdf",
                  },
                }),
              });
          }),
      ),
    );
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    const dropzone = screen.getByTestId("composer-dropzone");
    const file = new File(["hello"], "slow.pdf", { type: "application/pdf" });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "요약해줘" },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "전송" })).toBeDisabled();
    });

    resolveUpload?.();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "전송" })).not.toBeDisabled();
    });
  });
});

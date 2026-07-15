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

describe("ChatInput 슬래시/멘션", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const COMMANDS = [
    { id: "clear", label: "대화 지우기" },
    { id: "search", label: "웹 검색" },
  ];

  it("/ 입력 시 필터 팝오버가 뜨고 선택하면 onSlashCommand 가 호출되고 입력이 비워진다", () => {
    const onSlashCommand = vi.fn();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        slashCommands={COMMANDS}
        onSlashCommand={onSlashCommand}
      />,
    );
    const textarea = screen.getByLabelText(
      "메시지 입력",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "/검" } });
    expect(screen.getByText("웹 검색")).toBeInTheDocument();
    expect(screen.queryByText("대화 지우기")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("웹 검색"));
    expect(onSlashCommand).toHaveBeenCalledWith({
      id: "search",
      label: "웹 검색",
    });
    expect(textarea.value).toBe("");
  });

  it("@ 입력 시 엔티티 픽커가 뜨고 선택하면 참조 토큰이 삽입된다", () => {
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        mentionEntities={[
          { id: "tool-1", kind: "tool", label: "knowledge_search" },
          { id: "kb-1", kind: "knowledge", label: "product-spec" },
        ]}
      />,
    );
    const textarea = screen.getByLabelText(
      "메시지 입력",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "@know" } });
    expect(screen.getByText("knowledge_search")).toBeInTheDocument();
    expect(screen.queryByText("product-spec")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("knowledge_search"));
    expect(textarea.value).toBe("@knowledge_search ");
  });

  it("Escape 키로 팝오버를 닫고 입력 텍스트는 유지한다", () => {
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        slashCommands={COMMANDS}
      />,
    );
    const textarea = screen.getByLabelText(
      "메시지 입력",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "/대" } });
    expect(screen.getByText("대화 지우기")).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByText("대화 지우기")).not.toBeInTheDocument();
    expect(textarea.value).toBe("/대");
  });
});

describe("ChatInput 모델/모드 피커 (P10-T6-13)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const MODELS = ["claude-opus-4-7", "claude-sonnet-4-6"];

  it("availableModels 가 없으면 피커를 렌더하지 않는다", () => {
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("model-mode-picker")).not.toBeInTheDocument();
  });

  it("availableModels 가 있으면 피커를 렌더하고 기본 선택 모델을 전송 payload 에 반영한다", async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={onSend}
        onStop={vi.fn()}
        availableModels={MODELS}
      />,
    );
    expect(screen.getByLabelText("모델 선택")).toHaveValue("claude-opus-4-7");

    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "안녕" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        "안녕",
        [],
        expect.objectContaining({
          model: "claude-opus-4-7",
          mode: "agent",
          reasoningEffort: "medium",
        }),
      );
    });
  });

  it("모델/모드/추론강도를 변경하면 전송 payload 에 반영된다", async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={onSend}
        onStop={vi.fn()}
        availableModels={MODELS}
      />,
    );

    fireEvent.change(screen.getByLabelText("모델 선택"), {
      target: { value: "claude-sonnet-4-6" },
    });
    fireEvent.change(screen.getByLabelText("모드 선택"), {
      target: { value: "chat" },
    });
    fireEvent.change(screen.getByLabelText("추론 강도"), {
      target: { value: "high" },
    });
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "질문 있어" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        "질문 있어",
        [],
        expect.objectContaining({
          model: "claude-sonnet-4-6",
          mode: "chat",
          reasoningEffort: "high",
        }),
      );
    });
  });

  it("availableTools 에 web_search 가 없으면 웹검색 토글을 숨긴다", () => {
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        availableModels={MODELS}
        availableTools={["knowledge_search"]}
      />,
    );
    expect(
      screen.queryByTestId("model-picker-websearch"),
    ).not.toBeInTheDocument();
  });

  it("웹검색을 켜고 전송하면 payload 에 webSearch:true 가 반영된다", async () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        sessionId="session-1"
        isStreaming={false}
        onSend={onSend}
        onStop={vi.fn()}
        availableModels={MODELS}
        availableTools={["web_search"]}
      />,
    );

    fireEvent.click(screen.getByTestId("model-picker-websearch"));
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "최신 뉴스 찾아줘" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(onSend).toHaveBeenCalledWith(
        "최신 뉴스 찾아줘",
        [],
        expect.objectContaining({ webSearch: true }),
      );
    });
  });

  // P10-T6-17 — 에러/신뢰: 입력 draft 보존(세션별 sessionStorage).
  it("입력 draft 가 sessionStorage 에 보존되고 같은 sessionId 로 재마운트 시 복원된다", () => {
    const { unmount } = render(
      <ChatInput
        sessionId="draft-session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "임시로 작성 중인 초안" },
    });
    unmount();

    render(
      <ChatInput
        sessionId="draft-session-1"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("메시지 입력")).toHaveValue(
      "임시로 작성 중인 초안",
    );
  });

  it("전송하면 draft 가 sessionStorage 에서 제거된다", async () => {
    const onSend = vi.fn();
    const { unmount } = render(
      <ChatInput
        sessionId="draft-session-2"
        isStreaming={false}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("메시지 입력"), {
      target: { value: "전송할 내용" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await waitFor(() => expect(onSend).toHaveBeenCalled());
    unmount();

    render(
      <ChatInput
        sessionId="draft-session-2"
        isStreaming={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("메시지 입력")).toHaveValue("");
  });
});

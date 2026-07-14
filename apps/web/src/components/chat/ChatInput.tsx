"use client";

// components/chat/ChatInput.tsx — 19-UIUX-UPGRADE § 컴포저(C1-FE) P10-T6-11.
//   📎 버튼 + 드래그드롭(드롭존 하이라이트) + 이미지 붙여넣기 → useAttachments 로 업로드해
//   제거가능한 첨부 칩을 렌더. 전송 시 onSend(content, [{uploadId}]) 로 완료된 첨부만 전달.
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useAttachments } from "../../hooks/useAttachments";

export interface ChatInputHandle {
  setValue(value: string): void;
  focus(): void;
}

export interface ChatInputProps {
  sessionId: string;
  isStreaming: boolean;
  onSend: (
    content: string,
    attachments: Array<{ uploadId: string }>,
  ) => void | Promise<void>;
  onStop: () => void;
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput({ sessionId, isStreaming, onSend, onStop }, ref) {
    const [input, setInput] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { items, addFiles, remove, clear, readyUploadIds } =
      useAttachments(sessionId);

    useImperativeHandle(
      ref,
      () => ({
        setValue(value: string) {
          setInput(value);
        },
        focus() {
          taRef.current?.focus();
        },
      }),
      [],
    );

    function autogrow() {
      const ta = taRef.current;
      if (!ta) return;
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    }

    const uploading = items.some((it) => it.status === "uploading");
    const canSend = input.trim().length > 0 && !isStreaming && !uploading;

    async function submit() {
      if (!canSend) return;
      const content = input.trim();
      const attachments = readyUploadIds;
      setInput("");
      if (taRef.current) taRef.current.style.height = "auto";
      clear();
      await onSend(content, attachments);
    }

    function onFormSubmit(e: FormEvent) {
      e.preventDefault();
      void submit();
    }

    function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void submit();
      }
    }

    function onDragOver(e: DragEvent) {
      e.preventDefault();
      setDragActive(true);
    }

    function onDragLeave(e: DragEvent) {
      e.preventDefault();
      setDragActive(false);
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();
      setDragActive(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) addFiles(files);
    }

    function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
      const fileItems = Array.from(e.clipboardData?.items ?? []).filter(
        (item) => item.kind === "file",
      );
      if (fileItems.length === 0) return;
      const files = fileItems
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        addFiles(files);
      }
    }

    function onFileInputChange(e: ChangeEvent<HTMLInputElement>) {
      const files = Array.from(e.target.files ?? []);
      e.target.value = "";
      if (files.length > 0) addFiles(files);
    }

    return (
      <form
        onSubmit={onFormSubmit}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="composer-dropzone"
        data-drag-active={dragActive}
        className="mx-auto flex max-w-3xl flex-col gap-2 rounded-2xl border border-border bg-surface p-2 transition-colors data-[drag-active=true]:border-primary data-[drag-active=true]:bg-primary/5"
      >
        {items.length > 0 && (
          <ul
            aria-label="첨부 파일"
            data-testid="attachment-chips"
            className="flex flex-wrap gap-2 px-1"
          >
            {items.map((it) => (
              <li
                key={it.localId}
                data-testid={`attachment-chip-${it.localId}`}
                data-status={it.status}
                className="flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted data-[status=error]:border-accent data-[status=error]:text-accent"
              >
                <span className="max-w-[10rem] truncate">
                  {it.status === "uploading" ? "업로드 중… " : ""}
                  {it.filename}
                </span>
                <button
                  type="button"
                  aria-label={`${it.filename} 제거`}
                  onClick={() => remove(it.localId)}
                  className="grid h-4 w-4 flex-none place-items-center rounded-full text-fg-muted hover:bg-border hover:text-fg"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="attachment-file-input"
            onChange={onFileInputChange}
          />
          <button
            type="button"
            aria-label="파일 첨부"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-9 w-9 flex-none place-items-center rounded-xl text-lg text-fg-muted hover:bg-bg hover:text-fg"
          >
            📎
          </button>
          <textarea
            id="chat-input"
            ref={taRef}
            rows={1}
            aria-label="메시지 입력"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autogrow();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="메시지를 입력하세요…  (Enter 전송 · Shift+Enter 줄바꿈)"
            className="max-h-[200px] flex-1 resize-none bg-transparent px-2 py-1.5 text-fg outline-none placeholder:text-fg-muted"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={() => onStop()}
              aria-label="Stop"
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent text-lg leading-none text-white"
            >
              ■
            </button>
          ) : (
            <button
              type="submit"
              aria-label="전송"
              disabled={!canSend}
              className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary text-lg leading-none text-primary-fg transition disabled:opacity-40"
            >
              ↑
            </button>
          )}
        </div>
      </form>
    );
  },
);

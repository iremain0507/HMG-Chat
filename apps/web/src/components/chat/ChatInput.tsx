"use client";

// components/chat/ChatInput.tsx — 19-UIUX-UPGRADE § 컴포저(C1-FE/C2) P10-T6-11/12.
//   📎 버튼 + 드래그드롭(드롭존 하이라이트) + 이미지 붙여넣기 → useAttachments 로 업로드해
//   제거가능한 첨부 칩을 렌더. 전송 시 onSend(content, [{uploadId}]) 로 완료된 첨부만 전달.
//   메시지 시작이 "/" 면 슬래시 액션 팝오버(필터→선택 시 onSlashCommand 콜백), "@" 면 멘션
//   엔티티 픽커(첨부된 파일 + 호출부가 넘긴 tool/knowledge 엔티티 → "@label " 참조 토큰 삽입).
import React, {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useAttachments } from "../../hooks/useAttachments";
import { ComposerPopover, type ComposerPopoverItem } from "./ComposerPopover";

export interface ChatInputHandle {
  setValue(value: string): void;
  focus(): void;
}

export interface SlashCommand {
  id: string;
  label: string;
  description?: string;
}

export type MentionEntityKind = "file" | "tool" | "knowledge";

export interface MentionEntity {
  id: string;
  kind: MentionEntityKind;
  label: string;
}

const MENTION_KIND_BADGE: Record<MentionEntityKind, string> = {
  file: "파일",
  tool: "툴",
  knowledge: "지식",
};

interface TriggerState {
  type: "slash" | "mention";
  start: number;
  end: number;
  query: string;
}

function detectTrigger(value: string, cursor: number): TriggerState | null {
  let i = cursor - 1;
  while (i >= 0 && value[i] !== "/" && value[i] !== "@") {
    if (/\s/.test(value[i] ?? "")) return null;
    i--;
  }
  if (i < 0) return null;
  const ch = value[i];
  if (ch === undefined) return null;
  if (ch === "/" && i !== 0) return null;
  return {
    type: ch === "/" ? "slash" : "mention",
    start: i,
    end: cursor,
    query: value.slice(i + 1, cursor).toLowerCase(),
  };
}

export interface ChatInputProps {
  sessionId: string;
  isStreaming: boolean;
  onSend: (
    content: string,
    attachments: Array<{ uploadId: string }>,
  ) => void | Promise<void>;
  onStop: () => void;
  slashCommands?: SlashCommand[];
  onSlashCommand?: (command: SlashCommand) => void;
  mentionEntities?: MentionEntity[];
}

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(
  function ChatInput(
    {
      sessionId,
      isStreaming,
      onSend,
      onStop,
      slashCommands = [],
      onSlashCommand,
      mentionEntities = [],
    },
    ref,
  ) {
    const [input, setInput] = useState("");
    const [dragActive, setDragActive] = useState(false);
    const [trigger, setTrigger] = useState<TriggerState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { items, addFiles, remove, clear, readyUploadIds } =
      useAttachments(sessionId);

    const fileMentionEntities = useMemo<MentionEntity[]>(
      () =>
        items
          .filter((it) => it.status === "done")
          .map((it) => ({
            id: it.localId,
            kind: "file" as const,
            label: it.filename,
          })),
      [items],
    );
    const allMentionEntities = useMemo(
      () => [...fileMentionEntities, ...mentionEntities],
      [fileMentionEntities, mentionEntities],
    );

    const filteredSlashCommands = useMemo(
      () =>
        trigger?.type === "slash"
          ? slashCommands.filter((c) =>
              c.label.toLowerCase().includes(trigger.query),
            )
          : [],
      [trigger, slashCommands],
    );
    const filteredMentionEntities = useMemo(
      () =>
        trigger?.type === "mention"
          ? allMentionEntities.filter((e) =>
              e.label.toLowerCase().includes(trigger.query),
            )
          : [],
      [trigger, allMentionEntities],
    );

    const popoverItems: ComposerPopoverItem[] =
      trigger?.type === "slash"
        ? filteredSlashCommands.map((c) => ({ id: c.id, label: c.label }))
        : trigger?.type === "mention"
          ? filteredMentionEntities.map((e) => ({
              id: e.id,
              label: e.label,
              badge: MENTION_KIND_BADGE[e.kind],
            }))
          : [];

    function selectPopoverItem(item: ComposerPopoverItem) {
      if (!trigger) return;
      if (trigger.type === "slash") {
        const command = filteredSlashCommands.find((c) => c.id === item.id);
        setInput("");
        setTrigger(null);
        if (command) onSlashCommand?.(command);
        taRef.current?.focus();
        return;
      }
      const entity = filteredMentionEntities.find((e) => e.id === item.id);
      if (!entity) return;
      const before = input.slice(0, trigger.start);
      const after = input.slice(trigger.end);
      setInput(`${before}@${entity.label} ${after}`);
      setTrigger(null);
      taRef.current?.focus();
    }

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
      setTrigger(null);
      if (taRef.current) taRef.current.style.height = "auto";
      clear();
      await onSend(content, attachments);
    }

    function onFormSubmit(e: FormEvent) {
      e.preventDefault();
      void submit();
    }

    function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (trigger && popoverItems.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % popoverItems.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveIndex(
            (i) => (i - 1 + popoverItems.length) % popoverItems.length,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const item = popoverItems[activeIndex];
          if (item) selectPopoverItem(item);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setTrigger(null);
          return;
        }
      }
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
        <div className="relative flex items-end gap-2">
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
          {trigger && popoverItems.length > 0 && (
            <ComposerPopover
              items={popoverItems}
              activeIndex={activeIndex}
              onHover={setActiveIndex}
              onSelect={selectPopoverItem}
              label={trigger.type === "slash" ? "명령 선택" : "멘션 선택"}
            />
          )}
          <textarea
            id="chat-input"
            ref={taRef}
            rows={1}
            aria-label="메시지 입력"
            value={input}
            onChange={(e) => {
              const value = e.target.value;
              const cursor = e.target.selectionStart ?? value.length;
              setInput(value);
              autogrow();
              setTrigger(detectTrigger(value, cursor));
              setActiveIndex(0);
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

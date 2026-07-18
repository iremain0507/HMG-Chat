"use client";

// components/chat/ChatInput.tsx — 19-UIUX-UPGRADE § 컴포저(C1-FE/C2/C3) P10-T6-11/12/13,
//   P13-T6-04 F05 핸드오프 정렬: 첨부칩 행 → textarea(auto-grow ≤10줄) → 액션바
//   [＋][@][/]·ModelModePicker(모델칩·모드 세그먼트·웹검색)·컨텍스트 게이지(mono)·전송/Stop.
//   [+] 는 파일 첨부(기존 동작 유지, 드래그드롭·붙여넣기 병행), [@]/[/] 는 커서 위치에 트리거
//   문자를 삽입해 기존 detectTrigger 흐름(타이핑으로 열리는 것과 동일 경로)을 그대로 연다.
//   슬래시는 "메시지 시작 위치"에서만 유효하므로(§ detectTrigger) 입력이 비어있을 때만 활성화.
//   @멘션 팝오버는 카테고리 탭(전체/에이전트/도구/커넥터/파일/지식)+정책 배지(읽기 전용/승인
//   필요)를 노출 — MentionEntity.policy 가 있으면 배지로, kind 는 탭 필터 기준으로 쓰인다.
import React, {
  forwardRef,
  useEffect,
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
import { Plus, AtSign, Slash, Hash, ArrowUp, Square } from "lucide-react";
import { useAttachments } from "../../hooks/useAttachments";
import { useDismiss } from "../../hooks/useDismiss";
import type { SendOptions } from "../../hooks/useSessionStream";
import {
  ComposerPopover,
  optionDomId,
  type ComposerPopoverCategory,
  type ComposerPopoverItem,
} from "./ComposerPopover";
import {
  ModelModePicker,
  type ChatMode,
  type ReasoningEffort,
} from "./ModelModePicker";

export interface ChatInputHandle {
  setValue(value: string): void;
  focus(): void;
}

export interface SlashCommand {
  id: string;
  label: string;
  description?: string;
}

export type MentionEntityKind =
  "agent" | "tool" | "connector" | "file" | "knowledge";

export type MentionEntityPolicy = "readonly" | "approval";

export interface MentionEntity {
  id: string;
  kind: MentionEntityKind;
  label: string;
  subtitle?: string;
  policy?: MentionEntityPolicy;
}

const MENTION_KIND_LABEL: Record<MentionEntityKind, string> = {
  agent: "에이전트",
  tool: "도구",
  connector: "커넥터",
  file: "파일",
  knowledge: "지식",
};

const MENTION_CATEGORIES: ComposerPopoverCategory[] = [
  { id: "all", label: "전체" },
  { id: "agent", label: "에이전트" },
  { id: "tool", label: "도구" },
  { id: "connector", label: "커넥터" },
  { id: "file", label: "파일" },
  { id: "knowledge", label: "지식" },
];

const POLICY_BADGE: Record<
  MentionEntityPolicy,
  { label: string; variant: "neutral" | "warning" }
> = {
  readonly: { label: "읽기 전용", variant: "neutral" },
  approval: { label: "승인 필요", variant: "warning" },
};

interface TriggerState {
  type: "slash" | "mention" | "document";
  start: number;
  end: number;
  query: string;
}

// P20-T6-09 — `#` 는 업로드 문서 인라인 참조 트리거. `@` 와 동일하게 커서 위치 어디서든
// 열리되(슬래시만 메시지 시작 위치 한정), 선택 시 attachments 는 그대로(useAttachments 가
// 이미 완료 첨부 전부를 자동 포함) 두고 본문에 `#filename` 참조 텍스트만 삽입한다.
function detectTrigger(value: string, cursor: number): TriggerState | null {
  let i = cursor - 1;
  while (i >= 0 && value[i] !== "/" && value[i] !== "@" && value[i] !== "#") {
    if (/\s/.test(value[i] ?? "")) return null;
    i--;
  }
  if (i < 0) return null;
  const ch = value[i];
  if (ch === undefined) return null;
  if (ch === "/" && i !== 0) return null;
  return {
    type: ch === "/" ? "slash" : ch === "#" ? "document" : "mention",
    start: i,
    end: cursor,
    query: value.slice(i + 1, cursor).toLowerCase(),
  };
}

// P10-T6-17 — 입력 draft 보존: 세션별로 sessionStorage 에 임시 저장해 새로고침/재마운트에도
// 작성 중이던 내용을 잃지 않게 한다.
export function draftKey(sessionId: string): string {
  return `wchat:draft:${sessionId}`;
}

function readDraft(sessionId: string): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(draftKey(sessionId)) ?? "";
  } catch {
    return "";
  }
}

export interface ChatInputProps {
  sessionId: string;
  isStreaming: boolean;
  onSend: (
    content: string,
    // P22-T6-04 — uploadId 외 filename/mimeType/previewUrl(이미지 objectURL)을 함께 넘겨
    // 낙관적 유저 버블이 이미지 썸네일을 그릴 수 있게 한다. 서버 요청 body 에는
    // useSessionStream 이 uploadId 만 추린다(추가 필드는 무시).
    attachments: Array<{
      uploadId: string;
      filename: string;
      mimeType: string;
      previewUrl?: string;
    }>,
    options?: SendOptions,
  ) => void | Promise<void>;
  onStop: () => void;
  slashCommands?: SlashCommand[];
  onSlashCommand?: (command: SlashCommand) => void;
  mentionEntities?: MentionEntity[];
  availableModels?: string[];
  availableTools?: string[];
  // P10-T6-17 — 오프라인 상태 등 외부 사유로 전송을 막을 때 사용(§19.5 D4).
  disabled?: boolean;
  // P13-T6-04 — F05 액션바 우측 컨텍스트 게이지. 실 토큰 사용량 배선은 별도 태스크 소관이라
  // 호출부가 값을 넘기지 않으면(undefined) 게이지를 렌더하지 않는다.
  contextUsagePercent?: number;
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
      availableModels = [],
      availableTools = [],
      disabled = false,
      contextUsagePercent,
    },
    ref,
  ) {
    const [input, setInput] = useState(() => readDraft(sessionId));
    const [dragActive, setDragActive] = useState(false);
    const [trigger, setTrigger] = useState<TriggerState | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [mentionCategory, setMentionCategory] = useState("all");
    const [model, setModel] = useState(availableModels[0] ?? "");
    const [effort, setEffort] = useState<ReasoningEffort>("medium");
    const [mode, setMode] = useState<ChatMode>("agent");
    const [webSearch, setWebSearch] = useState(false);
    const [temporary, setTemporary] = useState(false);
    const taRef = useRef<HTMLTextAreaElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { items, addFiles, remove, clear, readyAttachments } =
      useAttachments(sessionId);
    const webSearchAvailable = availableTools.includes("web_search");

    // availableModels 가 마운트 후 비동기로 로드되면(useCurrentUser → org.allowedModels) 첫 항목을 기본 선택.
    useEffect(() => {
      if (availableModels.length > 0 && !availableModels.includes(model)) {
        setModel(availableModels[0] ?? "");
      }
    }, [availableModels, model]);

    // P10-T6-17 — 입력 draft 보존: 값이 바뀔 때마다 세션별 키로 sessionStorage 에 동기화.
    useEffect(() => {
      if (typeof window === "undefined") return;
      try {
        if (input) window.sessionStorage.setItem(draftKey(sessionId), input);
        else window.sessionStorage.removeItem(draftKey(sessionId));
      } catch {
        // sessionStorage 접근 불가(프라이빗 모드 등) — draft 보존은 best-effort.
      }
    }, [input, sessionId]);

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

    // P20-T6-09 — `#` 문서 피커: 업로드가 완료(uploadId 확보)된 첨부만 참조 가능하게 한다.
    // id 를 uploadId 로 둬 attachments[].uploadId 와 대응이 명확하도록 한다.
    const documentEntities = useMemo(
      () =>
        items
          .filter((it) => it.status === "done" && it.uploadId !== null)
          .map((it) => ({ id: it.uploadId as string, label: it.filename })),
      [items],
    );
    const filteredDocumentEntities = useMemo(
      () =>
        trigger?.type === "document"
          ? documentEntities.filter((e) =>
              e.label.toLowerCase().includes(trigger.query),
            )
          : [],
      [trigger, documentEntities],
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
          ? allMentionEntities
              .filter((e) => e.label.toLowerCase().includes(trigger.query))
              .filter(
                (e) => mentionCategory === "all" || e.kind === mentionCategory,
              )
          : [],
      [trigger, allMentionEntities, mentionCategory],
    );

    const popoverItems: ComposerPopoverItem[] =
      trigger?.type === "slash"
        ? filteredSlashCommands.map((c) => ({ id: c.id, label: c.label }))
        : trigger?.type === "mention"
          ? filteredMentionEntities.map((e) => {
              const policyBadge = e.policy ? POLICY_BADGE[e.policy] : null;
              return {
                id: e.id,
                label: e.label,
                subtitle: e.subtitle ?? MENTION_KIND_LABEL[e.kind],
                badge: policyBadge?.label,
                badgeVariant: policyBadge?.variant,
              };
            })
          : trigger?.type === "document"
            ? filteredDocumentEntities.map((e) => ({
                id: e.id,
                label: e.label,
                subtitle: "문서",
              }))
            : [];

    const activeOptionId =
      trigger && popoverItems.length > 0
        ? optionDomId(popoverItems[activeIndex]?.id ?? "")
        : undefined;

    // P21-T6-07 — 데스크톱(≥md)에서도 팝오버 밖 pointerdown 시 닫히도록(backdrop 은
    // md:hidden 이라 모바일에서만 유효했다). textarea 는 계속 편집 가능해야 하므로
    // triggerRef 로 제외한다.
    useDismiss(popoverRef, () => setTrigger(null), {
      enabled: !!trigger && popoverItems.length > 0,
      triggerRef: taRef,
    });

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
      if (trigger.type === "document") {
        const doc = filteredDocumentEntities.find((e) => e.id === item.id);
        if (!doc) return;
        const before = input.slice(0, trigger.start);
        const after = input.slice(trigger.end);
        setInput(`${before}#${doc.label} ${after}`);
        setTrigger(null);
        taRef.current?.focus();
        return;
      }
      const entity = filteredMentionEntities.find((e) => e.id === item.id);
      if (!entity) return;
      const before = input.slice(0, trigger.start);
      const after = input.slice(trigger.end);
      setInput(`${before}@${entity.label} ${after}`);
      setTrigger(null);
      setMentionCategory("all");
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

    // P13-T6-04 — [@]/[/] 액션바 버튼: 커서 위치(또는 시작 위치)에 트리거 문자를 삽입해
    // 타이핑으로 여는 것과 동일한 detectTrigger 경로를 재사용한다.
    function triggerMention() {
      const ta = taRef.current;
      const cursor = ta?.selectionStart ?? input.length;
      const before = input.slice(0, cursor);
      const after = input.slice(cursor);
      const nextValue = `${before}@${after}`;
      const nextCursor = cursor + 1;
      setInput(nextValue);
      setMentionCategory("all");
      setTrigger(detectTrigger(nextValue, nextCursor));
      setActiveIndex(0);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    // P20-T6-09 — [#] 액션바 버튼: @/mention 과 동일한 삽입 경로로 문서 피커를 연다.
    function triggerDocument() {
      const ta = taRef.current;
      const cursor = ta?.selectionStart ?? input.length;
      const before = input.slice(0, cursor);
      const after = input.slice(cursor);
      const nextValue = `${before}#${after}`;
      const nextCursor = cursor + 1;
      setInput(nextValue);
      setTrigger(detectTrigger(nextValue, nextCursor));
      setActiveIndex(0);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(nextCursor, nextCursor);
      });
    }

    function triggerSlash() {
      if (input.length > 0) return;
      const ta = taRef.current;
      setInput("/");
      setTrigger({ type: "slash", start: 0, end: 1, query: "" });
      setActiveIndex(0);
      requestAnimationFrame(() => {
        ta?.focus();
        ta?.setSelectionRange(1, 1);
      });
    }

    const uploading = items.some((it) => it.status === "uploading");
    const canSend =
      input.trim().length > 0 && !isStreaming && !uploading && !disabled;

    async function submit() {
      if (!canSend) return;
      const content = input.trim();
      const attachments = readyAttachments;
      setInput("");
      setTrigger(null);
      if (taRef.current) taRef.current.style.height = "auto";
      clear();
      if (availableModels.length > 0) {
        await onSend(content, attachments, {
          model,
          mode,
          reasoningEffort: effort,
          ...(webSearchAvailable ? { webSearch } : {}),
          ...(temporary ? { temporary: true } : {}),
        });
      } else if (temporary) {
        await onSend(content, attachments, { temporary: true });
      } else {
        await onSend(content, attachments);
      }
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
        className="relative mx-auto flex max-w-3xl flex-col gap-2 rounded-[14px] border border-border bg-surface p-3 transition-colors focus-within:border-primary-400 focus-within:outline focus-within:outline-2 focus-within:outline-primary-400 focus-within:outline-offset-2 data-[drag-active=true]:border-primary data-[drag-active=true]:bg-primary-50"
      >
        {trigger && popoverItems.length > 0 && (
          <ComposerPopover
            items={popoverItems}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onSelect={selectPopoverItem}
            label={
              trigger.type === "slash"
                ? "명령 선택"
                : trigger.type === "document"
                  ? "문서 선택"
                  : "멘션 선택"
            }
            query={trigger.query}
            showFooterHints
            onDismiss={() => setTrigger(null)}
            panelRef={popoverRef}
            {...(trigger.type === "mention"
              ? {
                  categories: MENTION_CATEGORIES,
                  activeCategory: mentionCategory,
                  onCategoryChange: setMentionCategory,
                }
              : {})}
          />
        )}
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
                className="flex items-center gap-1.5 rounded-full border border-border bg-bg py-1 pl-1.5 pr-2.5 text-xs text-fg-muted data-[status=error]:border-accent data-[status=error]:text-accent"
              >
                {it.previewUrl && (
                  // P22-T6-04 — 이미지 첨부는 파일명 대신 실제 썸네일을 보여준다(멀티모달 파리티).
                  // 동적 blob: URL 이라 next/image 부적합, 순수 img 사용(ToolCallRenderer 패턴).
                  <img
                    src={it.previewUrl}
                    alt={it.filename}
                    data-testid={`attachment-thumb-${it.localId}`}
                    className="h-6 w-6 flex-none rounded-md object-cover"
                  />
                )}
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          data-testid="attachment-file-input"
          onChange={onFileInputChange}
        />
        {temporary && (
          <p
            data-testid="composer-temporary-banner"
            className="px-1 text-xs text-fg-muted"
          >
            🕶️ 임시 채팅 — 이 대화는 저장되지 않습니다
          </p>
        )}
        <textarea
          id="chat-input"
          ref={taRef}
          rows={1}
          aria-label="메시지 입력"
          aria-activedescendant={activeOptionId}
          value={input}
          onChange={(e) => {
            const value = e.target.value;
            const cursor = e.target.selectionStart ?? value.length;
            setInput(value);
            autogrow();
            setTrigger(detectTrigger(value, cursor));
            setActiveIndex(0);
            setMentionCategory("all");
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={
            disabled
              ? "오프라인 상태입니다 — 연결이 복구되면 전송할 수 있어요."
              : "메시지를 입력하세요…  (Enter 전송 · Shift+Enter 줄바꿈)"
          }
          className="max-h-[200px] w-full resize-none bg-transparent px-1 py-1 text-fg outline-none placeholder:text-fg-muted"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-label="파일 첨부"
            onClick={() => fileInputRef.current?.click()}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-border text-fg-muted hover:bg-bg hover:text-fg"
          >
            <Plus size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="멘션 삽입"
            data-testid="composer-trigger-mention"
            onClick={triggerMention}
            aria-pressed={trigger?.type === "mention"}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-border text-fg-muted hover:bg-bg hover:text-fg aria-pressed:border-primary-200 aria-pressed:bg-primary-50 aria-pressed:text-primary"
          >
            <AtSign size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="명령어 삽입"
            data-testid="composer-trigger-slash"
            onClick={triggerSlash}
            disabled={input.length > 0}
            aria-pressed={trigger?.type === "slash"}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-border text-fg-muted hover:bg-bg hover:text-fg aria-pressed:border-primary-200 aria-pressed:bg-primary-50 aria-pressed:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Slash size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="문서 참조 삽입"
            data-testid="composer-trigger-document"
            onClick={triggerDocument}
            aria-pressed={trigger?.type === "document"}
            className="grid h-7 w-7 flex-none place-items-center rounded-md border border-border text-fg-muted hover:bg-bg hover:text-fg aria-pressed:border-primary-200 aria-pressed:bg-primary-50 aria-pressed:text-primary"
          >
            <Hash size={13} strokeWidth={2} aria-hidden="true" />
          </button>
          <ModelModePicker
            models={availableModels}
            model={model}
            onModelChange={setModel}
            effort={effort}
            onEffortChange={setEffort}
            mode={mode}
            onModeChange={setMode}
            webSearchAvailable={webSearchAvailable}
            webSearch={webSearch}
            onWebSearchChange={setWebSearch}
            temporary={temporary}
            onTemporaryChange={setTemporary}
          />
          <span className="flex-1" />
          {contextUsagePercent !== undefined && (
            <span
              data-testid="composer-context-gauge"
              className="font-mono text-xs tabular-nums text-placeholder"
            >
              {contextUsagePercent}%
            </span>
          )}
          {isStreaming ? (
            <button
              type="button"
              onClick={() => onStop()}
              aria-label="Stop"
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-white"
            >
              <Square size={13} strokeWidth={2.2} fill="currentColor" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="전송"
              disabled={!canSend}
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-primary text-primary-fg transition disabled:opacity-40"
            >
              <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
    );
  },
);

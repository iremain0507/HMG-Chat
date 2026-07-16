"use client";

// components/chat/ChatView.tsx — LLM 채팅 UI (ChatGPT/Claude 스타일).
//   헤더 + 메시지 버블(user 우측/assistant 아바타+마크다운) + 스트리밍 커서 + 하단 컴포저.
//   데이터: useSessionStream({ messages, isStreaming, send, stop }). Hyundai WIA CI 토큰.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useSessionStream,
  type MessagePart,
  type Citation,
  type MessageBranch,
} from "../../hooks/useSessionStream";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { randomUUID } from "../../lib/uuid";
import { showToast } from "../../lib/toast";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useProjects } from "../../hooks/useProjects";
import { useSessionProject } from "../../hooks/useSessionProject";
import { ArtifactCanvas } from "../artifacts/ArtifactCanvas";
import {
  ChatInput,
  type ChatInputHandle,
  type MentionEntity,
  type SlashCommand,
} from "./ChatInput";
import { HitlPrompt } from "./HitlPrompt";
import { Markdown } from "./Markdown";
import { MemoryPanel } from "./MemoryPanel";
import { MessageActions } from "./MessageActions";
import { ProjectPicker } from "./ProjectPicker";
import { RunRail, type RunRailStep } from "./RunRail";
import { ShareExportMenu } from "./ShareExportMenu";
import { ToolCallRenderer } from "./ToolCallRenderer";
import { ArrowDown } from "lucide-react";

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "memories", label: "memories", description: "저장된 메모리 보기" },
];

// P17-T6-02(TS-11) — org.allowedTools(실제 배선된 내장 도구, assemble-builtin-tools.ts
//   단일출처: artifact_create/web_search/code_interpreter/deep_research) 를 @ 피커
//   MentionEntity 로 매핑. deep_research 는 멀티에이전트 리서치 흐름이라 "에이전트"로 분류.
const TOOL_MENTION_META: Record<
  string,
  Pick<MentionEntity, "kind" | "label" | "policy">
> = {
  web_search: { kind: "tool", label: "web_search", policy: "readonly" },
  code_interpreter: { kind: "tool", label: "code_interpreter" },
  artifact_create: { kind: "tool", label: "artifact_create" },
  deep_research: { kind: "agent", label: "딥리서치" },
};

const BOTTOM_THRESHOLD_PX = 80;
const ANNOUNCE_DEBOUNCE_MS = 500;

const SUGGESTIONS = [
  "프로젝트 요약해줘",
  "회의록 초안 작성해줘",
  "이 코드 리뷰해줘",
];

export function ChatView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const {
    messages,
    isStreaming,
    send,
    stop,
    hitlRequest,
    respondHitl,
    artifacts,
    editMessage,
    switchBranch,
    historyLoading,
    loadHistory,
  } = useSessionStream(sessionId);
  const { org } = useCurrentUser();
  const online = useOnlineStatus();
  const { projects } = useProjects();
  const { projectId, setProject } = useSessionProject(sessionId);
  const [autoFollow, setAutoFollow] = useState(true);
  const [announceText, setAnnounceText] = useState("");
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [activeArtifactIndex, setActiveArtifactIndex] = useState(0);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [sourcesFocusIndex, setSourcesFocusIndex] = useState<number | null>(
    null,
  );
  const [rightPanelFocus, setRightPanelFocus] = useState<{
    tab: "artifacts" | "sources" | "activity";
    token: number;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const wasStreamingRef = useRef(isStreaming);
  const prevArtifactCountRef = useRef(0);
  const panelFocusTokenRef = useRef(0);

  // 인용 [N] 칩 클릭 — design-reference §6 CitationChip: 우패널 '출처' 탭 활성 + 원문 하이라이트.
  function handleCitationFocus(index: number) {
    setSourcesFocusIndex(index);
    setArtifactPanelOpen(true);
    setRightPanelFocus({
      tab: "sources",
      token: ++panelFocusTokenRef.current,
    });
  }

  // Run Rail 눈금 클릭(TS-11 #5) — 우패널 '활동' 탭 오픈(RunRail 은 순수 표시+콜백만 담당).
  function handleActivityFocus() {
    setArtifactPanelOpen(true);
    setRightPanelFocus({
      tab: "activity",
      token: ++panelFocusTokenRef.current,
    });
  }

  // @ 피커(TS-11 #1) — dev preview 고정 목록이 아니라 org.allowedTools 로 실배선된 도구만 노출.
  const mentionEntities = useMemo<MentionEntity[]>(
    () =>
      (org?.allowedTools ?? []).flatMap((id) => {
        const meta = TOOL_MENTION_META[id];
        return meta ? [{ id, ...meta }] : [];
      }),
    [org?.allowedTools],
  );

  // 원문 하이라이트(primary-100)는 2초 후 페이드아웃 — design-reference §6:
  // "클릭: 우패널 '출처' 탭 활성 + 해당 원문 블록 하이라이트(primary-100 배경 2초 페이드)".
  useEffect(() => {
    if (sourcesFocusIndex === null) return;
    const timer = setTimeout(() => setSourcesFocusIndex(null), 2000);
    return () => clearTimeout(timer);
  }, [sourcesFocusIndex]);

  // 우패널 '출처' 탭에 보여줄 인용 목록 — 세션 전체가 아니라 인용이 달린 가장 최근
  // assistant 턴 기준(design-reference F4: 그 턴의 Reference 와 동일 집합).
  const sourcesCitations = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.citations && m.citations.length > 0) return m.citations;
    }
    return [];
  }, [messages]);

  // 우패널 '활동' 탭에 보여줄 진행 스냅샷 — 가장 최근 tool_progress 를 가진 tool part.
  const activityProgress = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const parts = messages[i]?.parts ?? [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const p = parts[j];
        if (p && p.type === "tool" && p.progress) return p.progress;
      }
    }
    return undefined;
  }, [messages]);

  // artifact_created 자동 오픈+토스트 — 18-FRONTEND-WIREFRAMES § 18.5.1 "ArtifactContext.open()",
  // design-reference §4: artifact_created → 우패널 '아티팩트' 탭 자동 오픈 + 토스트.
  useEffect(() => {
    if (artifacts.length > prevArtifactCountRef.current) {
      setActiveArtifactIndex(artifacts.length - 1);
      setArtifactPanelOpen(true);
      setRightPanelFocus({
        tab: "artifacts",
        token: ++panelFocusTokenRef.current,
      });
      const created = artifacts[artifacts.length - 1];
      if (created) showToast("success", `새 아티팩트: ${created.filename}`);
    }
    prevArtifactCountRef.current = artifacts.length;
  }, [artifacts]);

  // Cmd/Ctrl+\ 패널 토글 — 18-FRONTEND-WIREFRAMES § 18.5.1 키맵.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setArtifactPanelOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && autoFollow) el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, autoFollow]);

  // P17-T6-01(TS-08) — 세션을 열 때(마운트/세션 전환) 과거 대화를 서버에서 복원.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const lastMessage = messages[messages.length - 1];
  const lastAssistantContent =
    lastMessage?.role === "assistant" ? lastMessage.content : "";

  // 빠른 델타마다 SR 안내가 갱신되면 스크린리더가 매 글자를 읽어 소음이 되므로,
  // 델타가 잠잠해진 뒤(트레일링 디바운스)에만 announcer 텍스트를 갱신한다.
  useEffect(() => {
    if (!lastAssistantContent) return;
    const timer = setTimeout(() => {
      setAnnounceText(lastAssistantContent);
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [lastAssistantContent]);

  // Stop 버튼이 사라지며(또는 disabled 전송 버튼으로 대체되며) 포커스가 유실된
  // 경우에만 입력창으로 복귀시킨다 — 사용자가 다른 요소에 의도적으로 포커스했다면
  // 그대로 둔다 (그것이야말로 "새 turn 이 포커스를 탈취"하지 않는다는 뜻이다).
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const active = document.activeElement;
      const lostFocus =
        active === document.body ||
        (active instanceof HTMLButtonElement && active.disabled);
      if (lostFocus) chatInputRef.current?.focus();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAutoFollow(distanceFromBottom < BOTTOM_THRESHOLD_PX);
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAutoFollow(true);
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col bg-bg text-fg">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="rounded-lg px-2 py-1 text-sm text-fg-muted hover:text-fg"
          >
            ← 홈
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-primary">WChat</span>
            <ProjectPicker
              projects={projects}
              projectId={projectId}
              onSelect={(next) => void setProject(next)}
            />
          </div>
          <div className="flex items-center gap-2">
            <ShareExportMenu
              title="WChat 대화"
              messages={messages.map((m) => ({
                role: m.role,
                content: m.content,
              }))}
              artifacts={artifacts}
            />
            <button
              type="button"
              onClick={() => router.push(`/chat/${randomUUID()}`)}
              className="rounded-lg border border-border px-3 py-1 text-sm text-fg-muted hover:border-primary hover:text-fg"
            >
              ＋ 새 채팅
            </button>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            data-testid="chat-scroll"
            onScroll={onScroll}
            role="log"
            aria-live="polite"
            aria-atomic="false"
            className="h-full overflow-y-auto"
          >
            <div className="sr-only" data-testid="stream-announcer">
              {announceText}
            </div>
            {historyLoading ? (
              <div
                data-testid="history-loading"
                className="grid h-full place-items-center text-sm text-fg-muted"
              >
                대화 불러오는 중…
              </div>
            ) : empty ? (
              <div className="grid h-full place-items-center px-6">
                <div className="text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary text-2xl font-bold text-primary-fg">
                    W
                  </div>
                  <h1 className="mt-5 text-2xl font-semibold">
                    무엇을 도와드릴까요?
                  </h1>
                  <p className="mt-2 text-fg-muted">
                    메시지를 입력해 대화를 시작하세요.
                  </p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => {
                          chatInputRef.current?.setValue(s);
                          chatInputRef.current?.focus();
                        }}
                        className="rounded-full border border-border bg-surface px-3.5 py-2 text-sm text-fg-muted hover:border-primary hover:text-fg"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <ul
                aria-label="메시지 목록"
                className="mx-auto max-w-3xl space-y-6 px-4 py-6"
              >
                {messages.map((m, i) => {
                  const canRegenerate = m.role === "assistant" && !isStreaming;
                  return (
                    <MessageItem
                      key={m.id}
                      role={m.role}
                      content={m.content}
                      {...(m.parts ? { parts: m.parts } : {})}
                      {...(m.citations ? { citations: m.citations } : {})}
                      {...(m.branch ? { branch: m.branch } : {})}
                      error={m.error ?? false}
                      {...(m.retryable !== undefined
                        ? { retryable: m.retryable }
                        : {})}
                      {...(m.errorCategory
                        ? { errorCategory: m.errorCategory }
                        : {})}
                      streaming={
                        isStreaming &&
                        i === messages.length - 1 &&
                        m.role === "assistant"
                      }
                      onCitationFocus={handleCitationFocus}
                      onActivityFocus={handleActivityFocus}
                      {...(canRegenerate
                        ? {
                            onRegenerate: () => {
                              const priorUser = messages
                                .slice(0, i)
                                .reverse()
                                .find((prev) => prev.role === "user");
                              if (priorUser) void send(priorUser.content);
                            },
                          }
                        : {})}
                      {...(m.role === "user"
                        ? {
                            onEditSubmit: (nextContent: string) =>
                              void editMessage(m.id, nextContent),
                            onSwitchBranch: (direction: "prev" | "next") =>
                              switchBranch(m.id, direction),
                          }
                        : {})}
                    />
                  );
                })}
              </ul>
            )}
          </div>
          {!autoFollow && (
            <button
              type="button"
              onClick={scrollToBottom}
              aria-label="최신으로↓"
              className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-bg px-3.5 py-2 text-xs font-medium text-primary shadow-md hover:bg-surface"
            >
              최신으로
              <ArrowDown size={13} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>

        {hitlRequest && (
          <HitlPrompt request={hitlRequest} onRespond={respondHitl} />
        )}

        {memoryPanelOpen && (
          <div className="border-t border-border px-4 pt-3">
            <MemoryPanel onClose={() => setMemoryPanelOpen(false)} />
          </div>
        )}

        {!online && (
          <div
            data-testid="offline-banner"
            role="status"
            className="border-t border-accent/30 bg-accent/10 px-4 py-2 text-center text-xs text-accent"
          >
            오프라인 상태입니다 — 연결이 복구되면 다시 전송할 수 있어요.
          </div>
        )}

        <div className="border-t border-border px-4 py-3">
          <ChatInput
            ref={chatInputRef}
            sessionId={sessionId}
            isStreaming={isStreaming}
            disabled={!online}
            onStop={() => void stop()}
            onSend={(content, attachments, options) =>
              send(content, attachments, options)
            }
            slashCommands={SLASH_COMMANDS}
            onSlashCommand={(command) => {
              if (command.id === "memories") setMemoryPanelOpen(true);
            }}
            mentionEntities={mentionEntities}
            availableModels={org?.allowedModels ?? []}
            availableTools={org?.allowedTools ?? []}
          />
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-fg-muted">
            WChat은 dev-stub 응답을 표시할 수 있습니다.
          </p>
        </div>
      </div>

      {artifactPanelOpen &&
        (artifacts.length > 0 ||
          sourcesCitations.length > 0 ||
          !!activityProgress) && (
          <ArtifactCanvas
            artifacts={artifacts}
            activeIndex={Math.min(
              activeArtifactIndex,
              Math.max(artifacts.length - 1, 0),
            )}
            onActiveIndexChange={setActiveArtifactIndex}
            onClose={() => setArtifactPanelOpen(false)}
            citations={sourcesCitations}
            focusedCitationIndex={sourcesFocusIndex}
            {...(activityProgress ? { activityProgress } : {})}
            onActivityStop={() => void stop()}
            {...(rightPanelFocus ? { focusTab: rightPanelFocus } : {})}
          />
        )}
    </div>
  );
}

export function MessageItem({
  role,
  content,
  parts,
  citations,
  branch,
  streaming,
  error,
  retryable,
  errorCategory,
  onRegenerate,
  onEditSubmit,
  onSwitchBranch,
  onCitationFocus,
  onActivityFocus,
}: {
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];
  citations?: Citation[];
  branch?: MessageBranch;
  streaming: boolean;
  error?: boolean;
  retryable?: boolean;
  errorCategory?: string;
  onRegenerate?: () => void;
  onEditSubmit?: (nextContent: string) => void;
  onSwitchBranch?: (direction: "prev" | "next") => void;
  onCitationFocus?: (index: number) => void;
  onActivityFocus?: () => void;
}) {
  const [focusedCitation, setFocusedCitation] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const onCitationClick = (index: number) => {
    setFocusedCitation(index);
    const el = document.getElementById(`citation-ref-${index}`);
    el?.scrollIntoView?.({ block: "nearest" });
    onCitationFocus?.(index);
  };
  if (error) {
    // P10-T6-17 — 재시도 가능(retryable:true) 오류만 재시도 버튼 노출(크레딧부족 등
    // 비재시도 오류는 노출 안 함). rate-limit 카테고리는 429 백오프 안내를 덧붙인다.
    return (
      <li data-role="error" className="flex gap-3">
        <div className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent text-sm font-bold text-white">
          !
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          <span>
            <span className="font-semibold">오류</span> · {content}
            {errorCategory === "rate-limit" && (
              <span className="ml-1 text-accent/80">
                잠시 후 다시 시도해주세요.
              </span>
            )}
          </span>
          {retryable && onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="flex-none rounded-full border border-accent/40 px-2 py-0.5 text-xs text-accent hover:bg-accent/10"
            >
              재시도
            </button>
          )}
        </div>
      </li>
    );
  }
  if (role === "user") {
    if (isEditing) {
      return (
        <li data-role="user" className="flex justify-end">
          <div className="w-full max-w-[80%]">
            <div className="flex flex-col gap-2 rounded-2xl border border-primary bg-surface p-2">
              <textarea
                aria-label="메시지 편집"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[60px] w-full resize-none bg-transparent px-1 py-1 text-sm text-fg outline-none"
              />
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="rounded-md px-2 py-1 text-fg-muted hover:text-fg"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    if (draft.trim() && draft !== content) {
                      onEditSubmit?.(draft);
                    }
                  }}
                  className="rounded-md bg-primary px-2 py-1 text-primary-fg"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </li>
      );
    }
    return (
      <li data-role="user" className="group flex justify-end">
        <div className="max-w-[80%]">
          <div className="whitespace-pre-wrap rounded-[10px] bg-primary-50 px-4 py-2.5 text-fg">
            {content}
          </div>
          <div className="mt-1 flex items-center justify-end gap-2">
            {branch && branch.count > 1 && (
              <div className="flex items-center gap-1 text-fg-muted">
                <button
                  type="button"
                  aria-label="이전 분기"
                  disabled={branch.index === 1}
                  onClick={() => onSwitchBranch?.("prev")}
                  className="rounded-md px-1 py-0.5 text-xs hover:text-fg disabled:opacity-30"
                >
                  ‹
                </button>
                <span data-testid="message-branch-pager" className="text-xs">
                  {branch.index} / {branch.count}
                </span>
                <button
                  type="button"
                  aria-label="다음 분기"
                  disabled={branch.index === branch.count}
                  onClick={() => onSwitchBranch?.("next")}
                  className="rounded-md px-1 py-0.5 text-xs hover:text-fg disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
            <div className="opacity-0 transition-opacity group-hover:opacity-100">
              <MessageActions
                role="user"
                content={content}
                onEdit={() => {
                  setDraft(content);
                  setIsEditing(true);
                }}
              />
            </div>
          </div>
        </div>
      </li>
    );
  }
  const hasToolParts = (parts ?? []).some((p) => p.type === "tool");
  const runRailSteps: RunRailStep[] = (parts ?? [])
    .filter((p) => p.type === "tool")
    .map((p) => ({ id: p.toolCallId, label: p.name, status: p.status }));
  return (
    <li data-role="assistant" className="group flex gap-3">
      {hasToolParts && (
        <RunRail steps={runRailSteps} onStepClick={() => onActivityFocus?.()} />
      )}
      <div className="min-w-0 flex-1">
        {hasToolParts ? (
          <div className="space-y-3">
            {(parts ?? []).map((part, idx) =>
              part.type === "tool" ? (
                <ToolCallRenderer
                  key={part.toolCallId}
                  toolCallId={part.toolCallId}
                  name={part.name}
                  args={part.args}
                  status={part.status}
                  {...(part.result !== undefined
                    ? { result: part.result }
                    : {})}
                  {...(part.progress ? { progress: part.progress } : {})}
                  {...(part.status === "error" && onRegenerate
                    ? { onRetry: onRegenerate }
                    : {})}
                />
              ) : part.text ? (
                <Markdown
                  key={`text-${idx}`}
                  streaming={streaming}
                  {...(citations ? { citations } : {})}
                  onCitationClick={onCitationClick}
                >
                  {part.text}
                </Markdown>
              ) : null,
            )}
          </div>
        ) : content ? (
          <Markdown
            streaming={streaming}
            {...(citations ? { citations } : {})}
            onCitationClick={onCitationClick}
          >
            {content}
          </Markdown>
        ) : null}
        {citations && citations.length > 0 && (
          <div
            data-testid="citation-reference-footer"
            className="mt-3 border-t border-border pt-2 text-xs text-fg-muted"
          >
            <div className="font-semibold text-fg">Reference</div>
            <ul className="mt-1 space-y-1">
              {citations.map((c, i) => (
                <li
                  // deep_research 는 하위 질문별 인용을 합쳐 index 가 중복될 수 있어(예: 1,1)
                  //   React key 는 위치 기반으로 유니크하게 준다. (전역 재번호는 서버 후속.)
                  key={`cit-${i}-${c.index}`}
                  id={`citation-ref-${c.index}`}
                  data-testid={`citation-ref-${c.index}`}
                  data-focused={focusedCitation === c.index}
                  className="rounded px-1 py-0.5 data-[focused=true]:bg-primary/10 data-[focused=true]:text-fg"
                >
                  [{c.index}] {c.filename}
                  {c.page ? ` p.${c.page}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {streaming && !content && !hasToolParts && (
          <div
            data-testid="shimmer"
            aria-label="응답 생성 중"
            className="space-y-2"
          >
            <div className="h-3.5 w-3/4 animate-pulse rounded bg-surface" />
            <div className="h-3.5 w-1/2 animate-pulse rounded bg-surface" />
          </div>
        )}
        {streaming && content && (
          <span
            className="ml-0.5 inline-block h-4 w-[3px] animate-pulse bg-fg align-middle"
            aria-label="응답 생성 중"
          />
        )}
        {!streaming && (
          <div className="mt-1 opacity-0 transition-opacity group-hover:opacity-100">
            <MessageActions
              role="assistant"
              content={content}
              {...(onRegenerate ? { onRegenerate } : {})}
            />
          </div>
        )}
      </div>
    </li>
  );
}

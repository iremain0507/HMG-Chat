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
  type StreamMessageMeta,
  type ArtifactSummary,
  type MessageAttachment,
} from "../../hooks/useSessionStream";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { usePrompts } from "../../hooks/usePrompts";
import { randomUUID } from "../../lib/uuid";
import { showToast } from "../../lib/toast";
import { apiFetch } from "../../lib/fetch-with-refresh";
import { substitutePromptVariables } from "../../lib/promptVariables";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useProjects } from "../../hooks/useProjects";
import { useSessionProject } from "../../hooks/useSessionProject";
import { ArtifactCanvas } from "../artifacts/ArtifactCanvas";
import { ArtifactCard } from "../artifacts/ArtifactCard";
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
import { Reasoning } from "./Reasoning";
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

// P19-T6-09 — 후속질문 칩: 턴 완료 후 서버(P19-T2-04 POST /:id/followups)에서 받은
// 3개 질문을 렌더한다. dev-stub/조회 실패 시 orchestrator/followups.ts 가 파생 폴백을
// 항상 반환하지만, 네트워크 오류까지는 이 클라이언트가 fail-soft 로 흡수한다(빈 배열,
// L2/L5 — 칩이 안 보일 뿐 조용히 죽지 않음).
async function fetchFollowups(sessionId: string): Promise<string[]> {
  try {
    const res = await apiFetch(`/api/v1/sessions/${sessionId}/followups`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data: { followups: string[] } };
    return body.data.followups ?? [];
  } catch {
    return [];
  }
}

export function ChatView({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const {
    messages,
    isStreaming,
    send,
    queuedMessages,
    removeQueued,
    stop,
    hitlRequest,
    respondHitl,
    artifacts,
    editMessage,
    regenerate,
    continueMessage,
    deleteMessage,
    switchBranch,
    historyLoading,
    loadHistory,
    loadArtifacts,
  } = useSessionStream(sessionId);
  const { user, org } = useCurrentUser();
  const { prompts } = usePrompts();
  const online = useOnlineStatus();
  const { projects } = useProjects();
  const { projectId, setProject } = useSessionProject(sessionId);
  const [autoFollow, setAutoFollow] = useState(true);
  const [announceText, setAnnounceText] = useState("");
  const [followups, setFollowups] = useState<string[]>([]);
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

  // 인라인 아티팩트 카드 클릭(P18-T6-01) — 기존 자동오픈(artifact_created useEffect,
  // ChatView.tsx:162-174)과 동일한 열람 흐름(activeArtifactIndex + 우패널 아티팩트 탭)을 재사용.
  function handleOpenArtifact(artifactId: string) {
    const index = artifacts.findIndex((a) => a.artifactId === artifactId);
    if (index === -1) return;
    setActiveArtifactIndex(index);
    setArtifactPanelOpen(true);
    setRightPanelFocus({
      tab: "artifacts",
      token: ++panelFocusTokenRef.current,
    });
  }

  // 메시지 귀속(P18-T6-01) — artifact_created 는 라이브에서 assistantId 로 messageId 를
  // 채우지만(useSessionStream.ts), messageId 가 없는 아티팩트(세션 단위 폴백)는 마지막
  // assistant 메시지 하단에 몰아서 노출한다.
  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "assistant") return messages[i]?.id ?? null;
    }
    return null;
  }, [messages]);
  const orphanArtifacts = useMemo(
    () => artifacts.filter((a) => !a.messageId),
    [artifacts],
  );
  function artifactsForMessage(messageId: string): ArtifactSummary[] {
    const own = artifacts.filter((a) => a.messageId === messageId);
    return messageId === lastAssistantMessageId
      ? [...own, ...orphanArtifacts]
      : own;
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

  // P19-T6-13 — 프롬프트 라이브러리(/api/v1/prompts)를 '/' 자동완성 목록에 합류. id 는
  // "prompt:<promptId>" 로 감싸 정적 SLASH_COMMANDS(memories 등)와 충돌하지 않게 한다.
  const promptSlashCommands = useMemo<SlashCommand[]>(
    () =>
      prompts.map((p) => ({
        id: `prompt:${p.id}`,
        label: p.command.replace(/^\//, ""),
        description: p.title,
      })),
    [prompts],
  );
  const slashCommands = useMemo<SlashCommand[]>(
    () => [...SLASH_COMMANDS, ...promptSlashCommands],
    [promptSlashCommands],
  );

  // P19-T6-13 — 선택된 프롬프트 본문의 {{today}}/{{user}}/{{clipboard}} 를 삽입 직전 치환.
  // 클립보드 접근이 거부/미지원이어도(L2) throw 없이 빈 문자열로 대체한다.
  async function insertPromptContent(content: string) {
    let clipboardText: string | undefined;
    if (
      content.includes("{{clipboard}}") &&
      typeof navigator !== "undefined" &&
      navigator.clipboard?.readText
    ) {
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch {
        clipboardText = "";
      }
    }
    const substituted = substitutePromptVariables(content, {
      ...(user?.name !== undefined ? { userName: user.name } : {}),
      ...(clipboardText !== undefined ? { clipboardText } : {}),
    });
    chatInputRef.current?.setValue(substituted);
    chatInputRef.current?.focus();
  }

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
      // P18-T6-02 — 복원된(restored) 항목만으로 늘어난 경우엔 "새 아티팩트"가 아니라
      // 재방문 시 기존 문서를 되찾은 것뿐이므로 자동오픈+토스트를 건너뛴다.
      const newlyAdded = artifacts.slice(prevArtifactCountRef.current);
      const allRestored = newlyAdded.every((a) => a.restored);
      if (!allRestored) {
        setActiveArtifactIndex(artifacts.length - 1);
        setArtifactPanelOpen(true);
        setRightPanelFocus({
          tab: "artifacts",
          token: ++panelFocusTokenRef.current,
        });
        const created = artifacts[artifacts.length - 1];
        if (created) showToast("success", `새 아티팩트: ${created.filename}`);
      }
    }
    prevArtifactCountRef.current = artifacts.length;
  }, [artifacts]);

  // P17-T6-04(TS-12) — deep_research tool_use 가 도착하면 클릭 없이도 우패널 활동 탭을
  // 자동 오픈(artifact_created 자동오픈과 동일 패턴). toolCallId 별 1회만 트리거되도록
  // 이미 본 id 를 기억해, tool_progress/tool_result 후속 이벤트로 messages 가 재계산돼도
  // 활동 탭이 반복해서 강제로 다시 포커스되지 않게 한다(사용자가 다른 탭으로 옮겨도 유지).
  const seenDeepResearchCallsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts ?? []) {
        if (
          p.type === "tool" &&
          p.name === "deep_research" &&
          !seenDeepResearchCallsRef.current.has(p.toolCallId)
        ) {
          seenDeepResearchCallsRef.current.add(p.toolCallId);
          setArtifactPanelOpen(true);
          setRightPanelFocus({
            tab: "activity",
            token: ++panelFocusTokenRef.current,
          });
        }
      }
    }
  }, [messages]);

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

  // P21-T6-18(UX-25) — 토큰 델타마다(messages 참조 변경) 강제 스크롤을 재실행하면
  // 유저의 미세 스크롤(위 스크롤이 80px 임계값 안이라 autoFollow 는 아직 true)을
  // 매 델타마다 하단으로 되감아버린다. 메시지 "개수"가 실제로 바뀐 순간에만 스크롤한다.
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    const el = scrollRef.current;
    const countChanged = messages.length !== prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (el && autoFollow && countChanged) el.scrollTop = el.scrollHeight;
  }, [messages.length, autoFollow]);

  // P17-T6-01(TS-08) — 세션을 열 때(마운트/세션 전환) 과거 대화를 서버에서 복원.
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // P18-T6-02 — 세션을 열 때 아티팩트도 함께 복원(라이브 스트림으로만 채워지면
  // 재방문/새로고침 시 사라짐, P18 증상②).
  useEffect(() => {
    void loadArtifacts();
  }, [loadArtifacts]);

  const lastMessage = messages[messages.length - 1];
  const lastAssistantContent =
    lastMessage?.role === "assistant" ? lastMessage.content : "";

  // P17-T6-08(TS-24) — 오프라인→온라인 복귀 시, SSE 드롭+재연결(resume)까지 실패해
  // 남은 network 오류(errorCategory==="network")만 골라 사용자 클릭 없이 자동 재전송한다.
  // (rate-limit 등 다른 재시도 가능 오류까지 무조건 자동 재전송하면 안 되므로 카테고리로 한정.)
  // 지수 백오프: 같은 오프라인 구간에서 반복 실패할수록 대기시간을 2배씩 늘린다(최대 16초).
  const wasOnlineRef = useRef(online);
  const reconnectAttemptRef = useRef(0);
  useEffect(() => {
    if (!online) {
      reconnectAttemptRef.current = 0;
    }
  }, [online]);
  useEffect(() => {
    const cameBackOnline = online && wasOnlineRef.current === false;
    wasOnlineRef.current = online;
    if (!cameBackOnline) return;
    if (
      !lastMessage ||
      lastMessage.role !== "assistant" ||
      !lastMessage.error ||
      !lastMessage.retryable ||
      lastMessage.errorCategory !== "network"
    ) {
      return;
    }
    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current = attempt + 1;
    const delayMs = Math.min(1000 * 2 ** attempt, 16_000);
    const timer = setTimeout(() => {
      void regenerate(lastMessage.id);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [online, lastMessage, regenerate]);

  // 빠른 델타마다 SR 안내가 갱신되면 스크린리더가 매 글자를 읽어 소음이 되므로,
  // 델타가 잠잠해진 뒤(트레일링 디바운스)에만 announcer 텍스트를 갱신한다.
  useEffect(() => {
    if (!lastAssistantContent) return;
    const timer = setTimeout(() => {
      setAnnounceText(lastAssistantContent);
    }, ANNOUNCE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [lastAssistantContent]);

  // P19-T6-09 — 턴 완료(스트리밍 true→false 전환) 시 마지막 메시지가 정상 assistant
  // 응답이면 후속질문을 조회한다. wasStreamingRef 는 위 포커스 복귀 효과에서도 갱신되므로
  // 이 효과 전용 ref 로 분리해 "직전 렌더의 스트리밍 여부"를 독립적으로 추적한다.
  const prevStreamingForFollowupsRef = useRef(isStreaming);
  useEffect(() => {
    const wasStreaming = prevStreamingForFollowupsRef.current;
    prevStreamingForFollowupsRef.current = isStreaming;
    if (!wasStreaming || isStreaming) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || last.error) return;
    let cancelled = false;
    void fetchFollowups(sessionId).then((items) => {
      if (!cancelled) setFollowups(items);
    });
    return () => {
      cancelled = true;
    };
  }, [isStreaming, messages, sessionId]);

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
              sessionId={sessionId}
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
                      sessionId={sessionId}
                      messageId={m.id}
                      {...(m.attachments ? { attachments: m.attachments } : {})}
                      {...(m.parts ? { parts: m.parts } : {})}
                      {...(m.reasoning ? { reasoning: m.reasoning } : {})}
                      {...(m.citations ? { citations: m.citations } : {})}
                      {...(m.branch ? { branch: m.branch } : {})}
                      {...(m.truncated ? { truncated: m.truncated } : {})}
                      {...(m.meta ? { meta: m.meta } : {})}
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
                      artifacts={
                        m.role === "assistant" ? artifactsForMessage(m.id) : []
                      }
                      onOpenArtifact={handleOpenArtifact}
                      onCitationFocus={handleCitationFocus}
                      onActivityFocus={handleActivityFocus}
                      onDelete={() => void deleteMessage(m.id)}
                      {...(canRegenerate
                        ? {
                            // P17-T6-03(TS-06) — 재생성은 같은 user 턴 아래 새 assistant
                            // 형제를 만든다(중복 turn 아님, editMessage 와 동일 tree 의미).
                            onRegenerate: () => void regenerate(m.id),
                          }
                        : {})}
                      {...(canRegenerate && m.truncated
                        ? {
                            // P19-T6-08 — 이어쓰기: max_tokens 등으로 잘린 assistant 응답을
                            // 서버 continue 로 이어받아 같은 노드에 병합(새 턴 아님).
                            onContinue: () => void continueMessage(m.id),
                          }
                        : {})}
                      {...(canRegenerate &&
                      i === messages.length - 1 &&
                      followups.length > 0
                        ? {
                            // P19-T6-09 — 마지막 assistant 턴에만 후속질문 칩을 붙인다.
                            followups,
                            onFollowupClick: (question: string) => {
                              setFollowups([]);
                              void send(question);
                            },
                          }
                        : {})}
                      {...(m.role === "user"
                        ? {
                            onEditSubmit: (nextContent: string) =>
                              void editMessage(m.id, nextContent),
                          }
                        : {})}
                      onSwitchBranch={(direction: "prev" | "next") =>
                        switchBranch(m.id, direction)
                      }
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
            queuedMessages={queuedMessages}
            onRemoveQueued={removeQueued}
            slashCommands={slashCommands}
            onSlashCommand={(command) => {
              if (command.id === "memories") {
                setMemoryPanelOpen(true);
                return;
              }
              if (command.id.startsWith("prompt:")) {
                const promptId = command.id.slice("prompt:".length);
                const prompt = prompts.find((p) => p.id === promptId);
                if (prompt) void insertPromptContent(prompt.content);
              }
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

// P17-T6-08(TS-24) — 429/rate-limit 오류의 백오프 대기시간(서버가 Retry-After 를 아직
// 전달하지 않아 클라이언트 기본값을 쓴다). 카운트다운이 끝나면 사용자 클릭 없이 자동 재시도.
const RATE_LIMIT_BACKOFF_MS = 3000;

function useRateLimitCountdown(active: boolean, onExpire: () => void): number {
  const [retryAt] = useState(() => Date.now() + RATE_LIMIT_BACKOFF_MS);
  const [remainingMs, setRemainingMs] = useState(() => retryAt - Date.now());
  const firedRef = useRef(false);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;

  useEffect(() => {
    if (!active || remainingMs <= 0) return;
    const timer = setTimeout(() => setRemainingMs(retryAt - Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [active, remainingMs, retryAt]);

  useEffect(() => {
    if (active && remainingMs <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpireRef.current();
    }
  }, [active, remainingMs]);

  return Math.max(0, remainingMs);
}

export function MessageItem({
  role,
  content,
  sessionId,
  messageId,
  parts,
  reasoning,
  citations,
  branch,
  truncated,
  meta,
  streaming,
  error,
  retryable,
  errorCategory,
  artifacts,
  onRegenerate,
  onContinue,
  followups,
  onFollowupClick,
  onEditSubmit,
  onSwitchBranch,
  onCitationFocus,
  onActivityFocus,
  onOpenArtifact,
  onDelete,
  attachments,
}: {
  role: "user" | "assistant";
  content: string;
  sessionId?: string;
  messageId?: string;
  // P22-T6-04 — 유저 버블에 딸린 첨부(이미지는 previewUrl 썸네일로 렌더).
  attachments?: MessageAttachment[];
  parts?: MessagePart[];
  reasoning?: string;
  citations?: Citation[];
  branch?: MessageBranch;
  truncated?: boolean;
  meta?: StreamMessageMeta;
  streaming: boolean;
  error?: boolean;
  retryable?: boolean;
  errorCategory?: string;
  artifacts?: ArtifactSummary[];
  onRegenerate?: () => void;
  onContinue?: () => void;
  followups?: string[];
  onFollowupClick?: (question: string) => void;
  onEditSubmit?: (nextContent: string) => void;
  onSwitchBranch?: (direction: "prev" | "next") => void;
  onCitationFocus?: (index: number) => void;
  onActivityFocus?: () => void;
  onOpenArtifact?: (artifactId: string) => void;
  onDelete?: () => void;
}) {
  const [focusedCitation, setFocusedCitation] = useState<number | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const editTextareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!isEditing) return;
    const el = editTextareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [isEditing]);
  const onCitationClick = (index: number) => {
    setFocusedCitation(index);
    const el = document.getElementById(`citation-ref-${index}`);
    el?.scrollIntoView?.({ block: "nearest" });
    onCitationFocus?.(index);
  };
  const isRateLimitError = Boolean(
    error && errorCategory === "rate-limit" && retryable,
  );
  const rateLimitMsLeft = useRateLimitCountdown(isRateLimitError, () => {
    onRegenerate?.();
  });
  if (error) {
    // P10-T6-17 — 재시도 가능(retryable:true) 오류만 재시도 버튼 노출(크레딧부족 등
    // 비재시도 오류는 노출 안 함). rate-limit 카테고리는 mono 백오프 카운트다운을
    // 덧붙이고, 카운트다운이 끝나면 클릭 없이 자동으로 재시도한다(useRateLimitCountdown).
    const rateLimitSecondsLeft = Math.ceil(rateLimitMsLeft / 1000);
    return (
      <li data-role="error" className="flex gap-3">
        <div className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-lg bg-accent text-sm font-bold text-white">
          !
        </div>
        <div className="flex min-w-0 flex-1 items-start justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          <span>
            <span className="font-semibold">오류</span> · {content}
            {isRateLimitError && (
              <span
                data-testid="rate-limit-countdown"
                className="ml-1 font-mono tabular-nums text-accent/80"
              >
                {rateLimitSecondsLeft > 0
                  ? ` ${rateLimitSecondsLeft}초 후 자동 재시도`
                  : " 재시도 중…"}
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
                ref={editTextareaRef}
                aria-label="메시지 편집"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setIsEditing(false);
                }}
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
          {attachments && attachments.length > 0 && (
            // P22-T6-04 — 멀티모달 파리티(Open WebUI 참조): 이미지 첨부는 파일명 대신
            // 실제 썸네일(<img>)로, 비이미지는 파일명 칩으로 버블 위에 표시한다.
            <ul
              aria-label="첨부"
              className="mb-1.5 flex flex-wrap justify-end gap-1.5"
            >
              {attachments.map((a) => (
                <li key={a.uploadId}>
                  {a.previewUrl ? (
                    // 동적 blob: URL 이라 next/image 부적합, 순수 img 사용(ToolCallRenderer 패턴).
                    <img
                      src={a.previewUrl}
                      alt={a.filename}
                      data-testid={`bubble-thumb-${a.uploadId}`}
                      className="h-20 w-20 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted">
                      {a.filename}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
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
                {...(onDelete ? { onDelete } : {})}
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
        {reasoning && (
          <Reasoning
            content={reasoning}
            streaming={streaming}
            durationSec={0}
          />
        )}
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
        {artifacts && artifacts.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {artifacts.map((a) => (
              <ArtifactCard
                key={a.artifactId}
                artifact={a}
                onOpen={() => onOpenArtifact?.(a.artifactId)}
              />
            ))}
          </div>
        )}
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
        {(!streaming || (branch && branch.count > 1)) && (
          <div className="mt-1 flex items-center gap-2">
            {branch && branch.count > 1 && (
              <div className="flex items-center gap-1 text-fg-muted">
                <button
                  type="button"
                  aria-label="이전 응답"
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
                  aria-label="다음 응답"
                  disabled={branch.index === branch.count}
                  onClick={() => onSwitchBranch?.("next")}
                  className="rounded-md px-1 py-0.5 text-xs hover:text-fg disabled:opacity-30"
                >
                  ›
                </button>
              </div>
            )}
            {!streaming && truncated && onContinue && (
              <button
                type="button"
                onClick={onContinue}
                className="rounded-full border border-primary/40 px-2.5 py-0.5 text-xs text-primary hover:bg-primary/10"
              >
                이어쓰기
              </button>
            )}
            {!streaming && (
              <div className="opacity-0 transition-opacity group-hover:opacity-100">
                <MessageActions
                  role="assistant"
                  content={content}
                  {...(sessionId && messageId ? { sessionId, messageId } : {})}
                  {...(meta ? { meta } : {})}
                  {...(onRegenerate ? { onRegenerate } : {})}
                  {...(onDelete ? { onDelete } : {})}
                />
              </div>
            )}
          </div>
        )}
        {!streaming && followups && followups.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2" aria-label="후속질문 제안">
            {followups.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => onFollowupClick?.(q)}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-muted hover:border-primary hover:text-fg"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

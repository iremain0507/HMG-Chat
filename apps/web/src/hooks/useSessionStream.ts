"use client";

// hooks/useSessionStream.ts — 16-API-CONTRACT § POST /sessions/:id/messages (SSE) +
// DELETE /sessions/:id/active-run 소비. 18-FRONTEND-WIREFRAMES § 18.6.3 stream 처리
// reducer 를 Phase 2 서버 구현 범위(message_start/text_delta/stop/error)로 좁혀 구현 —
// tool_use/hitl_*/citation/artifact_created/message_replace 는 Phase 3/4 이후 확장.
//
// P10-T6-15 — 19-UIUX-UPGRADE 원칙 2(메시지=트리 데이터모델): 메시지를 부모 포인터
// (parentOf) + 형제 순서(childrenOf) + 활성 자식(activeChildOf) 로 저장하고, 공개
// `messages` 는 root→tip 활성경로만 매 렌더 계산해 노출한다. 편집(editMessage)은
// 대상 user 메시지와 같은 부모를 공유하는 새 형제 노드를 만들어 활성 자식으로 전환하고,
// switchBranch 는 활성 자식 포인터만 바꿔 이전에 스트리밍된 형제 분기를 그대로 복원한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { showToast } from "../lib/toast";
import { apiFetch } from "../lib/fetch-with-refresh";

export type ToolCallStatus = "queued" | "running" | "done" | "error";

// 14-INTERFACES § ToolProgress/ToolProgressTask 와 1:1 (실행 중 멀티에이전트 진행 스냅샷).
export interface ToolTask {
  id: string;
  title: string;
  status: "queued" | "running" | "done" | "error";
  sourceCount?: number;
}
export interface ToolProgressState {
  stage: "planning" | "researching" | "synthesizing" | "done";
  label?: string;
  tasks?: ToolTask[];
}

export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      args: unknown;
      status: ToolCallStatus;
      result?: string | unknown;
      // 실행 중 tool_progress 스냅샷(최신으로 교체). deep_research 등 멀티에이전트 라이브 표시.
      progress?: ToolProgressState;
    };

export interface MessageBranch {
  index: number;
  count: number;
}

// P20-T6-06 — 생성 메타(Info): stop ChatEvent.usage 와 message_start~stop 사이 경과시간을
// 클라이언트 전용으로 보존(wire format 은 그대로, 서버 필드 재가공 없음).
export interface StreamMessageMeta {
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs?: number;
}

export interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];
  // P20-T2-03 — 사고(reasoning) 스트림 누적. 최종 답변(content)과 별개, 접이식 표시.
  reasoning?: string;
  truncated?: boolean;
  error?: boolean;
  // P10-T6-17 — SerializedError(§14-INTERFACES) 의 retryable/category 를 그대로 반영.
  // retryable 인 오류만 재시도 버튼을 노출(크레딧부족 등 비재시도 오류는 노출 안 함).
  retryable?: boolean;
  errorCategory?: string;
  citations?: Citation[];
  branch?: MessageBranch;
  meta?: StreamMessageMeta;
  // P22-T6-04 — 유저 메시지에 딸린 첨부(이미지는 previewUrl objectURL 로 버블에 썸네일 렌더).
  // 낙관적 전송 시 ChatInput→send() 가 채운다. 서버 wire format 엔 없는 클라이언트 전용 필드.
  attachments?: MessageAttachment[];
}

// P22-T6-04 — 버블 렌더용 첨부 메타(서버 요청 body 엔 uploadId 만 실림).
export interface MessageAttachment {
  uploadId: string;
  filename: string;
  mimeType: string;
  previewUrl?: string;
}

// 14-INTERFACES § ChatEvent.citation 과 1:1 (type 필드 제외).
export interface Citation {
  index: number;
  source: "project" | "ephemeral";
  documentId?: string;
  uploadId?: string;
  filename: string;
  title?: string;
  page?: number;
  sourceUri?: string;
  snippet: string;
}

// 14-INTERFACES § ChatEvent.hitl_request 와 1:1 (toolCallId/toolName/args/rationale/expiresAt).
export interface HitlPromptData {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  expiresAt: string;
}

// 14-INTERFACES § ChatEvent.artifact_created 와 1:1 (artifactId/artifactKind/filename/sizeBytes/downloadUrl).
// messageId 는 서버 wire format 에 없는 클라이언트 전용 필드(P18-T6-01) — 라이브 스트림에서
// artifact_created 가 도착한 시점의 assistantId 로 채워, 메시지 인라인 카드 귀속에 쓴다.
// restored 도 클라이언트 전용(P18-T6-02) — GET /:id/artifacts 로 복원된 항목 표시. ChatView 의
// "새 아티팩트" 자동오픈+토스트가 재방문 시 기존 문서를 새 문서로 오인하지 않도록 구분하는 용도.
export interface ArtifactSummary {
  artifactId: string;
  artifactKind: string;
  filename: string;
  sizeBytes: number;
  downloadUrl?: string;
  messageId?: string;
  restored?: boolean;
}

// P10-T6-13 — 모델/모드 피커 선택값. 서버 계약(16-API-CONTRACT § POST /sessions/:id/messages)에
// 아직 없는 필드라 서버는 무시하지만(attachments 와 동일하게 알 수 없는 키는 c.req.json<{...}>()
// 파싱에서 그냥 버려짐), acceptance("선택이 전송 payload 반영")를 위해 body 에 포함해 전달한다.
export interface SendOptions {
  model?: string;
  mode?: "agent" | "chat";
  reasoningEffort?: "low" | "medium" | "high";
  webSearch?: boolean;
  // P19-T2-05/T6-11 — 임시 채팅: true 면 서버가 세션 upsert·메시지 영속을 스킵(미영속).
  temporary?: boolean;
}

// P22-T6-05 — 응답 생성 중 대기열에 쌓인(아직 미전송) 사용자 메시지. 스트림 종료 시
// FIFO 로 자동 디스패치되며, 그 전까지 컴포저에 취소 가능한 칩으로 표시된다.
export interface QueuedMessage {
  id: string;
  content: string;
  attachments?: MessageAttachment[];
}

// P22-T6-06 — 멀티모델 병렬 비교(Open WebUI 파리티). 하나의 프롬프트를 2+ 모델로 팬아웃해
// 각 모델 답변을 병렬 컬럼으로 스트리밍한다. 컬럼마다 독립적인 재생성(형제 답변)과 prev/next
// 네비게이션을 갖는다. 클라이언트 사이드 팬아웃(모델별 개별 POST /messages 를 병렬 발사)이라
// 서버 계약(16-API-CONTRACT)·packages/interfaces 변경 없이 T6 안에서 완결된다. 기존 단일경로
// 트리(messages)와 완전히 분리된 별도 상태라 단일모델 스트리밍 동작에는 전혀 영향이 없다.
export interface CompareAnswer {
  id: string;
  content: string;
  reasoning?: string;
  error?: boolean;
  streaming: boolean;
  meta?: StreamMessageMeta;
}
export interface CompareColumn {
  model: string;
  // 컬럼별 형제 답변(재생성 누적). activeIndex 가 화면에 보이는 답변.
  answers: CompareAnswer[];
  activeIndex: number;
}
export interface CompareGroup {
  id: string;
  userContent: string;
  columns: CompareColumn[];
}

type ChatStreamEvent =
  | {
      type: "message_start";
      messageId: string;
      meta?: { provider: string; model: string };
    }
  // P10-T6-17 — SSE 드롭 재연결/resume: GET .../messages/:messageId/stream 의 첫 이벤트로
  // 현재까지 누적된 content 를 동기화(16-API-CONTRACT § resume endpoint).
  | { type: "message_replace"; messageId: string; contentSoFar: string }
  | { type: "text_delta"; text: string }
  // P20-T2-03 — 사고(extended thinking) 스트림. 최종 답변과 별개 채널, 접이식 표시.
  | { type: "reasoning_delta"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown }
  | ({ type: "tool_progress"; toolCallId: string } & ToolProgressState)
  | {
      type: "hitl_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      rationale: string;
      expiresAt: string;
    }
  | {
      type: "hitl_resolved";
      toolCallId: string;
      decision: "approved" | "denied";
      modifiedArgs?: Record<string, unknown>;
      reason?: string;
    }
  | { type: "hitl_timeout"; toolCallId: string }
  | ({ type: "citation" } & Citation)
  | {
      type: "artifact_created";
      artifactId: string;
      artifactKind: string;
      filename: string;
      sizeBytes: number;
      downloadUrl?: string;
    }
  | {
      type: "stop";
      reason: "end_turn" | "tool_use" | "max_tokens" | "aborted";
      usage?: { inputTokens: number; outputTokens: number };
    }
  | {
      type: "error";
      // wire format = SerializedError(§14-INTERFACES/errors.ts) — category/retryable 은
      // 옵셔널로 받아 누락 시 false/undefined 로 안전 처리.
      error: {
        code: string;
        category?: string;
        message: string;
        retryable?: boolean;
      };
    };

// AgentToolResult.content(kind:"error") 는 orchestrator 가 { error: WChatError } 로
// 감싸 emit(orchestrator.ts toToolResultContent) — 그 shape 을 client 에서 재검출.
function isErrorToolResult(content: unknown): boolean {
  return typeof content === "object" && content !== null && "error" in content;
}

// P19-T6-12 — 완료 알림: 탭이 백그라운드(document.hidden)일 때만 턴 종단 1회 알림.
// 보이는 탭에서는 방해가 되므로 발생시키지 않고, 권한이 아직 결정 안 됐으면(default)
// 요청 후 승인 시에만 실제로 띄운다(거부 상태는 재요청하지 않음).
function notifyTurnComplete(): void {
  if (typeof document === "undefined" || !document.hidden) return;
  if (typeof Notification === "undefined") return;
  const fire = () => {
    try {
      new Notification("응답이 완료되었습니다");
    } catch {
      // Notification 생성자 실패(권한 취소 등)는 best-effort 알림이라 무시.
    }
  };
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    void Notification.requestPermission().then((permission) => {
      if (permission === "granted") fire();
    });
  }
}

function parseSseFrame(frame: string): ChatStreamEvent | null {
  let eventName: string | null = null;
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice("data:".length).trim();
    }
  }
  if (!eventName || !data) return null;
  try {
    return { type: eventName, ...JSON.parse(data) } as ChatStreamEvent;
  } catch {
    return null;
  }
}

// 트리 루트(부모가 없는 노드들)의 부모 키로 쓰는 센티널.
const ROOT = "";

interface TreeData {
  nodes: Record<string, StreamMessage>;
  parentOf: Record<string, string | null>;
  childrenOf: Record<string, string[]>;
  activeChildOf: Record<string, string>;
}

function createTree(): TreeData {
  return { nodes: {}, parentOf: {}, childrenOf: {}, activeChildOf: {} };
}

function getTipId(t: TreeData): string | null {
  let key = ROOT;
  let tip: string | null = null;
  for (;;) {
    const childId = t.activeChildOf[key];
    if (!childId) break;
    tip = childId;
    key = childId;
  }
  return tip;
}

export function useSessionStream(sessionId: string) {
  const treeRef = useRef<TreeData>(createTree());
  const idCounterRef = useRef(0);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const addNode = useCallback(
    (id: string, parentId: string | null, message: StreamMessage) => {
      const t = treeRef.current;
      t.nodes[id] = message;
      t.parentOf[id] = parentId;
      const key = parentId ?? ROOT;
      t.childrenOf[key] = [...(t.childrenOf[key] ?? []), id];
      t.activeChildOf[key] = id;
      bump();
    },
    [bump],
  );

  const updateNode = useCallback(
    (id: string, updater: (m: StreamMessage) => StreamMessage) => {
      const t = treeRef.current;
      const cur = t.nodes[id];
      if (!cur) return;
      t.nodes[id] = updater(cur);
      bump();
    },
    [bump],
  );

  const [isStreaming, setIsStreaming] = useState(false);
  const [hitlRequest, setHitlRequest] = useState<HitlPromptData | null>(null);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyLoadedRef = useRef(false);
  const artifactsLoadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // iOS 등 백그라운드 서스펜션 대응 — 진행 중 leg 의 reader / 스트리밍 여부 / 마지막 SSE 수신
  // 시각을 ref 로 들고 있다가, 앱 전환 후 foreground 복귀(visibilitychange) 시 "정말로 멈춘"
  // 연결만 골라 취소해 resume(재연결→최종답변 복구) 경로를 태운다.
  //
  // 주의: 서버는 클라이언트가 연결을 끊으면(=reader.cancel → fetch abort) 진행 중 턴을 즉시
  // abort 한다(routes/messages.ts, abort.test.ts — 비용 절감 목적). 따라서 살아있는 연결을
  // 무조건 취소하면 정상 생성 중인 답변이 잘린다. 그래서 취소하지 않고 먼저 지켜본다: 서버는
  // 10초마다 keep-alive(: ping)를 보내므로, 복귀 후 일정 시간(HEARTBEAT 초과) 동안 어떤
  // 바이트도 오지 않을 때만 죽은 연결로 보고 취소한다(정상 연결은 곧 ping 이 도착해 취소 안 함).
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const isStreamingRef = useRef(false);
  const lastActivityRef = useRef(0);
  const staleWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // P22-T6-05 — 응답 생성 중 추가 메시지 큐잉(Open WebUI 파리티). send() 가 스트리밍 중
  // 호출되면 in-flight leg 을 abort 하는 대신 큐(FIFO)에 쌓고, 스트림 종료 시 헤드를 자동
  // 디스패치한다. edit/regenerate/continue 의 overlap-abort 는 그대로 유지(사용자 큐잉만 예외).
  const queueRef = useRef<
    Array<{
      id: string;
      content: string;
      attachments?: MessageAttachment[];
      options?: SendOptions;
    }>
  >([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  // streamTurn 은 send/dispatchSend 보다 먼저 정의되므로(순환 참조 회피) ref 로 드레인 함수를
  // 노출해 finally 에서 호출한다.
  const drainQueueRef = useRef<() => void>(() => {});
  // loadHistory(streamTurn 보다 먼저 정의)가 진행 중 run 을 발견하면 이 ref 로 resume 을 킥오프한다.
  const resumeActiveRunRef = useRef<
    (parentNodeId: string, messageId: string) => Promise<void>
  >(async () => {});
  const syncQueueState = useCallback(() => {
    setQueuedMessages(
      queueRef.current.map((q) => ({
        id: q.id,
        content: q.content,
        ...(q.attachments && q.attachments.length > 0
          ? { attachments: q.attachments }
          : {}),
      })),
    );
  }, []);

  // P22-T6-06 — 멀티모델 병렬 비교 상태. compareGroupsRef 를 단일 진실원으로 두고 setter 에서
  // ref+state 를 함께 갱신해(트리 treeRef 와 동일 패턴), 병렬 leg 이 동시에 최신값 위에 함수형
  // 업데이트를 쌓아도 서로 덮어쓰지 않게 한다. compareControllersRef 는 진행 중 leg 의
  // AbortController 목록 — stop()/세션전환/언마운트 시 일괄 취소한다.
  const [compareGroups, setCompareGroups] = useState<CompareGroup[]>([]);
  const compareGroupsRef = useRef<CompareGroup[]>([]);
  const compareControllersRef = useRef<AbortController[]>([]);
  const setCompareGroupsSynced = useCallback(
    (updater: (prev: CompareGroup[]) => CompareGroup[]) => {
      compareGroupsRef.current = updater(compareGroupsRef.current);
      setCompareGroups(compareGroupsRef.current);
    },
    [],
  );
  const updateCompareAnswer = useCallback(
    (
      groupId: string,
      answerId: string,
      updater: (a: CompareAnswer) => CompareAnswer,
    ) => {
      setCompareGroupsSynced((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                columns: g.columns.map((col) => ({
                  ...col,
                  answers: col.answers.map((a) =>
                    a.id !== answerId ? a : updater(a),
                  ),
                })),
              },
        ),
      );
    },
    [setCompareGroupsSynced],
  );

  // P21-T6-04(UX-16) — 세션 전환 시 이전 대화가 그대로 남던 버그: 이 컴포넌트 인스턴스가
  // 재사용된 채(unmount 없이) sessionId prop 만 바뀌는 라우팅(App Router 클라이언트 내비게이션)
  // 에서는 treeRef/historyLoadedRef/artifactsLoadedRef 가 이전 세션 값을 그대로 들고 있어
  // loadHistory 가 조용히 early-return 했다. sessionId 가 실제로 바뀐 순간에만 트리/플래그를
  // 리셋하고, 이전 세션에서 진행 중이던 스트림은 abort 해 전환 후 도착하는 이벤트가 새 세션의
  // 상태를 오염시키지 않게 한다.
  const prevSessionIdRef = useRef(sessionId);
  useEffect(() => {
    if (prevSessionIdRef.current === sessionId) return;
    prevSessionIdRef.current = sessionId;

    abortRef.current?.abort();
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }

    // P22-T6-06 — 세션 전환 시 진행 중 비교 leg 취소 + 컬럼 상태 초기화.
    for (const c of compareControllersRef.current) c.abort();
    compareControllersRef.current = [];
    compareGroupsRef.current = [];
    setCompareGroups([]);

    treeRef.current = createTree();
    historyLoadedRef.current = false;
    artifactsLoadedRef.current = false;
    setArtifacts([]);
    setHitlRequest(null);
    setIsStreaming(false);
    isStreamingRef.current = false;
    setHistoryLoading(false);
    bump();
  }, [sessionId, bump]);

  // 컴포넌트가 완전히 언마운트될 때(세션 전환이 아니라 화면을 떠날 때)도 in-flight 스트림을
  // 정리한다 — 위 sessionId-변경 리셋과 별개로, 페이지 자체가 사라지는 경로를 커버.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      // P22-T6-06 — 화면 이탈 시 진행 중 비교 leg 도 정리.
      for (const c of compareControllersRef.current) c.abort();
      compareControllersRef.current = [];
      if (readerRef.current) {
        readerRef.current.cancel().catch(() => {});
        readerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    // 서버 keep-alive 주기(10s)보다 넉넉히 큰 값 — 이보다 오래 무수신이면 죽은 연결로 판정.
    const STALE_MS = 14_000;
    function clearWatchdog() {
      if (staleWatchdogRef.current) {
        clearTimeout(staleWatchdogRef.current);
        staleWatchdogRef.current = null;
      }
    }
    function onVisibilityChange() {
      if (typeof document === "undefined") return;
      clearWatchdog();
      if (document.visibilityState !== "visible") return;
      if (!isStreamingRef.current || !readerRef.current) return;
      // 복귀 시점의 마지막 활동 시각을 스냅샷. STALE_MS 뒤에도 그대로면(그 사이 어떤 SSE 도
      // 안 옴 = keep-alive 조차 없음) 연결이 죽은 것 → 현재 leg 을 취소해 resume 으로 넘긴다.
      const stamp = lastActivityRef.current;
      staleWatchdogRef.current = setTimeout(() => {
        staleWatchdogRef.current = null;
        if (
          isStreamingRef.current &&
          readerRef.current &&
          lastActivityRef.current === stamp
        ) {
          readerRef.current.cancel().catch(() => {});
        }
      }, STALE_MS);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearWatchdog();
    };
  }, []);

  // P17-T6-01(TS-08) — 세션 재진입/새로고침 시 GET /:id/messages 로 과거 대화를 복원한다.
  // P19-T6-01 — 서버가 각 메시지의 parentMessageId(P19-T1-01)를 반환하므로, 편집/재생성으로
  // 생긴 형제 분기를 그대로 트리에 복원한다(addNode 가 시간순 addNode 호출마다 activeChildOf 를
  // 최신 형제로 갱신하므로, 마지막에 추가된 형제가 자연히 활성 경로가 된다 — 라이브 스트리밍과 동일 규칙).
  // parentMessageId 가 없는 과거 데이터(레거시 응답)는 root 의 자식으로 취급해 선형 체인으로 복원된다.
  // 이미 로컬에 진행 중인 대화(예: 새 세션에서 첫 메시지를 보낸 직후)가 있으면 덮어쓰지 않는다.
  const loadHistory = useCallback(async () => {
    if (historyLoadedRef.current) return;
    if (Object.keys(treeRef.current.nodes).length > 0) return;
    historyLoadedRef.current = true;
    setHistoryLoading(true);
    // 진행 중(비종결) 턴이 있으면 서버가 activeRun.messageId 를 실어 준다 — 복원 후 resume 으로
    // 재연결해 서브에이전트/도구 카드를 되살리고 최종답변까지 이어받는다(새로고침 중 실행중).
    let activeRunMessageId: string | undefined;
    try {
      const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        data: Array<{
          id: string;
          role: string;
          content: unknown;
          parentMessageId?: string | null;
        }>;
        activeRun?: { messageId: string };
      };
      activeRunMessageId = body.activeRun?.messageId;
      let previousId: string | null = null;
      for (const row of body.data) {
        if (row.role !== "user" && row.role !== "assistant") continue;
        // 서버가 도구 호출이 있는 assistant 메시지를 {text,parts} 구조화로 저장한 경우, parts 를
        // 복원해 새로고침/세션이동 후에도 도구 카드(deep_research 등)를 유지한다. 그 외(문자열/레거시)
        // 는 기존처럼 텍스트로.
        const raw = row.content;
        let content: string;
        let restoredParts: MessagePart[] | undefined;
        if (typeof raw === "string") {
          content = raw;
        } else if (
          raw &&
          typeof raw === "object" &&
          Array.isArray((raw as { parts?: unknown }).parts)
        ) {
          const structured = raw as { text?: unknown; parts?: unknown };
          content = typeof structured.text === "string" ? structured.text : "";
          restoredParts = structured.parts as MessagePart[];
        } else if (raw == null) {
          content = "";
        } else {
          content = JSON.stringify(raw);
        }
        // parentMessageId 필드 자체가 없는 레거시 응답은 이전 메시지를 부모로 삼아 선형 체인으로
        // 복원한다(하위호환) — 필드가 있으면(null 포함) 서버가 준 실제 부모 포인터를 그대로 쓴다.
        const parentId = Object.prototype.hasOwnProperty.call(
          row,
          "parentMessageId",
        )
          ? (row.parentMessageId ?? null)
          : previousId;
        addNode(row.id, parentId, {
          id: row.id,
          role: row.role,
          content,
          ...(restoredParts ? { parts: restoredParts } : {}),
        });
        previousId = row.id;
      }
    } catch {
      // fail-soft — 히스토리 복원 실패 시 빈 대화로 시작(L2/L5, 조용한 실패 아닌 정상 폴백).
    } finally {
      setHistoryLoading(false);
    }
    // 복원 후 진행 중 턴이면 resume 킥오프 — placeholder assistant 를 마지막 노드(대개 방금
    // 복원한 user 메시지) 아래에 만들고 라이브 스트림에 재연결한다. 이미 로컬 진행 중이면 스킵.
    if (activeRunMessageId && !isStreamingRef.current) {
      const parentNodeId = getTipId(treeRef.current);
      if (parentNodeId) {
        await resumeActiveRunRef.current(parentNodeId, activeRunMessageId);
      }
    }
  }, [sessionId, addNode]);

  // P18-T6-02 — 세션 재진입 시 GET /:id/artifacts 로 아티팩트를 복원한다. 지금까지는
  // artifact_created 라이브 이벤트로만 artifacts state 가 채워져 재방문/새로고침 시
  // 문서가 사라졌다(P18 증상②). 서버 wire format(id/type)을 클라이언트 ArtifactSummary
  // (artifactId/artifactKind)로 매핑 — messageId 는 서버에 없어(frozen interfaces) 비워두고,
  // ChatView 의 기존 orphanArtifacts 폴백(마지막 assistant 메시지 귀속, P18-T6-01)에 맡긴다.
  // 이미 진행 중인 라이브 아티팩트가 있으면 덮어쓰지 않는다(loadHistory 와 동일한 폴백 원칙).
  const loadArtifacts = useCallback(async () => {
    if (artifactsLoadedRef.current) return;
    artifactsLoadedRef.current = true;
    try {
      const res = await apiFetch(`/api/v1/sessions/${sessionId}/artifacts`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        data: Array<{
          id: string;
          type: string;
          filename: string;
          sizeBytes: number;
        }>;
      };
      if (body.data.length === 0) return;
      setArtifacts((prev) =>
        prev.length > 0
          ? prev
          : body.data.map((a) => ({
              artifactId: a.id,
              artifactKind: a.type,
              filename: a.filename,
              sizeBytes: a.sizeBytes,
              restored: true,
            })),
      );
    } catch {
      // fail-soft — 복원 실패 시 아티팩트 없이 시작(L2/L5, 조용한 실패 아닌 정상 폴백).
    }
  }, [sessionId]);

  const messages = useMemo<StreamMessage[]>(() => {
    const t = treeRef.current;
    const path: StreamMessage[] = [];
    let key = ROOT;
    for (;;) {
      const childId = t.activeChildOf[key];
      if (!childId) break;
      const node = t.nodes[childId];
      if (!node) break;
      const siblings = t.childrenOf[key] ?? [];
      const branch: MessageBranch | undefined =
        siblings.length > 1
          ? { index: siblings.indexOf(childId) + 1, count: siblings.length }
          : undefined;
      path.push(branch ? { ...node, branch } : node);
      key = childId;
    }
    return path;
  }, [version]);

  const streamTurn = useCallback(
    async (
      userNodeId: string,
      content: string,
      attachments?: MessageAttachment[],
      options?: SendOptions,
      // 지정하면 POST 로 새 턴을 시작하지 않고, 이미 진행 중인 이 messageId 의 resume 스트림에
      // 곧장 재연결한다(새로고침/세션이동으로 라이브 스트림을 놓친 진행 중 턴 이어받기).
      resumeMessageId?: string,
    ): Promise<void> => {
      // P21-T6-12(UX-20/21) — send/editMessage/regenerate 는 모두 이 함수를 거쳐 새 턴을
      // 시작한다. 이전 leg 이 아직 스트리밍 중일 때 겹쳐 들어오면 두 leg 이 동시에 같은
      // 트리에 기록돼 이중기록이 난다 — 새 진입 시 이전 leg 을 먼저 abort 한다.
      if (isStreamingRef.current) {
        abortRef.current?.abort();
        if (readerRef.current) {
          readerRef.current.cancel().catch(() => {});
          readerRef.current = null;
        }
      }

      setIsStreaming(true);
      isStreamingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantId: string | null = null;
      // P20-T6-06 — 현재 leg 의 message_start 수신 시각(경과시간=stop 수신 시각과의 차).
      // 멀티-leg(tool_use 중간 stop) 은 leg 마다 새 assistant 노드가 생기므로 leg 별로 갱신한다.
      let legStartedAt: number | null = null;
      // P10-T6-17 — SSE 드롭 재연결/resume: message_start 가 발급한 서버 messageId 를
      // 기억해두면, stop/error 없이 스트림이 끊겼을 때 같은 messageId 로
      // GET .../messages/:messageId/stream (resume) 에 재연결할 수 있다.
      let lastServerMessageId: string | null = null;
      // stop/error 이벤트(정상 종결) 또는 재연결 실패 처리 완료를 받았는지 여부.
      // false 인 채로 read 루프가 끝나면(reader done) "드롭"으로 간주해 재연결을 시도한다.
      let receivedTerminal = false;

      function emitConnectionError() {
        const message = "연결이 끊어졌습니다. 다시 시도해주세요.";
        const errId = `local-err-${idCounterRef.current++}`;
        addNode(errId, assistantId ?? userNodeId, {
          id: errId,
          role: "assistant",
          content: message,
          error: true,
          retryable: true,
          // P17-T6-08(TS-24) — 오프라인→온라인 복귀 시 ChatView 가 이 카테고리의 재시도
          // 가능 오류만 골라 자동 재연결(regenerate)한다(rate-limit 등 다른 재시도
          // 가능 오류까지 무조건 자동 재전송하면 안 되므로 구분 필요).
          errorCategory: "network",
        });
        showToast("error", message);
        receivedTerminal = true;
      }

      function processEvent(event: ChatStreamEvent) {
        if (event.type === "message_start") {
          lastServerMessageId = event.messageId;
          // 트리 노드 키는 항상 내부에서 새로 발급한다 — 서버 messageId 를
          // 그대로 키로 쓰면 재생성/재시도처럼 같은 messageId 가 다른 턴에서도
          // 재사용될 수 있는 상황(테스트 목·서버 재사용 등)에서 이전 턴의
          // parent→child 포인터와 충돌해 트리에 사이클이 생긴다.
          assistantId = `local-a-${idCounterRef.current++}`;
          legStartedAt = Date.now();
          addNode(assistantId, userNodeId, {
            id: assistantId,
            role: "assistant",
            content: "",
            ...(event.meta
              ? {
                  meta: {
                    provider: event.meta.provider,
                    model: event.meta.model,
                  },
                }
              : {}),
          });
        } else if (event.type === "message_replace" && assistantId) {
          // resume 스트림의 첫 이벤트 — 지금까지 누적된 content 로 동기화하되, 백그라운드
          // 복귀 등으로 클라이언트가 이미 렌더한 도구 카드(type:"tool" 파트)는 절대 파괴하지
          // 않는다. contentSoFar 는 서버가 누적한 텍스트 스냅샷 — 클라이언트가 같거나 더 많은
          // 텍스트를 이미 들고 있으면(iOS 복귀 등 상태 보존) 그대로 두고, 뒤처졌거나 상태가
          // 비었을 때만 텍스트를 보정한다(도구 파트는 순서 유지하며 보존).
          updateNode(assistantId, (m) => {
            const existing = m.parts ?? [];
            if (
              existing.length > 0 &&
              m.content.length >= event.contentSoFar.length
            ) {
              return m;
            }
            const toolParts = existing.filter((p) => p.type !== "text");
            const textParts: MessagePart[] = event.contentSoFar
              ? [{ type: "text", text: event.contentSoFar }]
              : [];
            return {
              ...m,
              content: event.contentSoFar,
              parts: [...toolParts, ...textParts],
            };
          });
        } else if (event.type === "reasoning_delta" && assistantId) {
          // P20-T2-03 — 사고 스트림을 content 와 분리해 message.reasoning 에 누적(접이식 표시).
          updateNode(assistantId, (m) => ({
            ...m,
            reasoning: (m.reasoning ?? "") + event.text,
          }));
        } else if (event.type === "text_delta" && assistantId) {
          updateNode(assistantId, (m) => {
            const parts = m.parts ?? [];
            const last = parts.at(-1);
            const nextParts: MessagePart[] =
              last?.type === "text"
                ? [
                    ...parts.slice(0, -1),
                    { type: "text", text: last.text + event.text },
                  ]
                : [...parts, { type: "text", text: event.text }];
            return {
              ...m,
              content: m.content + event.text,
              parts: nextParts,
            };
          });
        } else if (event.type === "tool_use" && assistantId) {
          updateNode(assistantId, (m) => {
            const parts = m.parts ?? [];
            // 멱등 — 같은 toolCallId 카드가 이미 있으면(resume 재생/중복 이벤트) 새로 추가하지
            // 않고 그대로 둔다. 새로고침 resume 은 누적 도구 카드를 재생하므로 append 면 중복된다.
            if (
              parts.some(
                (p) => p.type === "tool" && p.toolCallId === event.toolCallId,
              )
            ) {
              return m;
            }
            return {
              ...m,
              parts: [
                ...parts,
                {
                  type: "tool",
                  toolCallId: event.toolCallId,
                  name: event.name,
                  args: event.args,
                  status: "running",
                },
              ],
            };
          });
        } else if (event.type === "tool_progress" && assistantId) {
          // 실행 중 진행 스냅샷을 해당 tool part 에 최신으로 교체(라이브 스윔레인).
          updateNode(assistantId, (m) =>
            m.parts
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.type === "tool" && p.toolCallId === event.toolCallId
                      ? {
                          ...p,
                          progress: {
                            stage: event.stage,
                            ...(event.label ? { label: event.label } : {}),
                            ...(event.tasks ? { tasks: event.tasks } : {}),
                          },
                        }
                      : p,
                  ),
                }
              : m,
          );
        } else if (event.type === "tool_result" && assistantId) {
          updateNode(assistantId, (m) =>
            m.parts
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.type === "tool" && p.toolCallId === event.toolCallId
                      ? {
                          ...p,
                          status: isErrorToolResult(event.content)
                            ? "error"
                            : "done",
                          result: event.content,
                        }
                      : p,
                  ),
                }
              : m,
          );
        } else if (event.type === "citation" && assistantId) {
          const citation: Citation = {
            index: event.index,
            source: event.source,
            filename: event.filename,
            snippet: event.snippet,
            ...(event.documentId !== undefined
              ? { documentId: event.documentId }
              : {}),
            ...(event.uploadId !== undefined
              ? { uploadId: event.uploadId }
              : {}),
            ...(event.title !== undefined ? { title: event.title } : {}),
            ...(event.page !== undefined ? { page: event.page } : {}),
            ...(event.sourceUri !== undefined
              ? { sourceUri: event.sourceUri }
              : {}),
          };
          updateNode(assistantId, (m) => ({
            ...m,
            citations: [...(m.citations ?? []), citation],
          }));
        } else if (event.type === "artifact_created") {
          setArtifacts((prev) => [
            ...prev,
            {
              artifactId: event.artifactId,
              artifactKind: event.artifactKind,
              filename: event.filename,
              sizeBytes: event.sizeBytes,
              ...(event.downloadUrl !== undefined
                ? { downloadUrl: event.downloadUrl }
                : {}),
              ...(assistantId ? { messageId: assistantId } : {}),
            },
          ]);
        } else if (event.type === "hitl_request") {
          setHitlRequest({
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
            rationale: event.rationale,
            expiresAt: event.expiresAt,
          });
        } else if (
          event.type === "hitl_resolved" ||
          event.type === "hitl_timeout"
        ) {
          setHitlRequest((prev) =>
            prev && prev.toolCallId === event.toolCallId ? null : prev,
          );
        } else if (event.type === "stop") {
          // reason "tool_use" 는 중간 종료(툴 실행 후 다음 leg 로 이어짐, orchestrator 가 leg
          //   마다 stop 을 yield) — 종단으로 처리하면 최종 leg 답변 전에 스트림이 끝난 것으로
          //   오인해 답변이 안 뜨고 도구 칩이 멈춘다. 진짜 종단(end_turn/max_tokens/aborted)만 처리.
          if (event.reason !== "tool_use") {
            receivedTerminal = true;
            setIsStreaming(false);
            notifyTurnComplete();
            // P20-T6-06 — 생성 메타(Info): message_start~stop 경과시간 + usage 를 보존.
            if (assistantId && legStartedAt !== null) {
              const elapsedMs = Date.now() - legStartedAt;
              const finishedAssistantId = assistantId;
              updateNode(finishedAssistantId, (m) => ({
                ...m,
                meta: {
                  ...m.meta,
                  elapsedMs,
                  ...(event.usage
                    ? {
                        inputTokens: event.usage.inputTokens,
                        outputTokens: event.usage.outputTokens,
                      }
                    : {}),
                },
              }));
            }
          }
          // P19-T6-08 — max_tokens 로 끊긴 응답은 truncated 로 표시해 이어쓰기 버튼을 노출한다.
          if (event.reason === "max_tokens" && assistantId) {
            updateNode(assistantId, (m) => ({ ...m, truncated: true }));
          }
        } else if (event.type === "error") {
          receivedTerminal = true;
          const message = event.error?.message ?? "알 수 없는 오류";
          const retryable = event.error?.retryable ?? false;
          const category = event.error?.category;
          const errId = `local-err-${idCounterRef.current++}`;
          addNode(errId, assistantId ?? userNodeId, {
            id: errId,
            role: "assistant",
            content: message,
            error: true,
            retryable,
            ...(category ? { errorCategory: category } : {}),
          });
          setIsStreaming(false);
          showToast("error", message);
        }
      }

      async function readFrom(res: {
        body?: ReadableStream<Uint8Array> | null;
      }): Promise<void> {
        const reader = res.body?.getReader();
        if (!reader) return;
        // visibilitychange 핸들러가 백그라운드 복귀 시 이 reader 를 취소할 수 있도록 노출한다.
        readerRef.current = reader;
        // stale 판정 기준점 — leg 시작 시각으로 초기화(첫 바이트 전에도 최근값 유지).
        lastActivityRef.current = Date.now();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            // keep-alive(: ping) 포함 어떤 바이트든 수신 = 연결 살아있음. stale 워치독 리셋용.
            lastActivityRef.current = Date.now();
            buffer += decoder.decode(value, { stream: true });

            let sepIndex = buffer.indexOf("\n\n");
            while (sepIndex !== -1) {
              const frame = buffer.slice(0, sepIndex);
              buffer = buffer.slice(sepIndex + 2);
              const event = parseSseFrame(frame);
              sepIndex = buffer.indexOf("\n\n");
              if (!event) continue;
              processEvent(event);
            }
          }
        } finally {
          if (readerRef.current === reader) readerRef.current = null;
        }
      }

      // 백그라운드 중 턴이 이미 완료돼 resume 이 410(gone)/404 를 주면, 서버엔 최종 답변이
      // 이미 영속돼 있다(POST finally 의 assistant insert). GET /:id/messages 의 마지막
      // assistant 행으로 로컬 placeholder 를 채워 "연결 끊김" 대신 완성된 답변을 보여준다.
      // 도구 카드(type:"tool" 파트)는 보존하고 텍스트만 최종본으로 보정한다.
      async function recoverFinalMessage(): Promise<boolean> {
        if (!assistantId) return false;
        try {
          const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
            credentials: "include",
          });
          if (!("ok" in res) || res.ok === false) return false;
          const body = (await (
            res as unknown as { json: () => Promise<unknown> }
          ).json()) as {
            data?: Array<{ role: string; content: unknown }>;
          };
          const rows = body.data ?? [];
          let finalContent: string | null = null;
          // 구조화({text,parts})로 저장된 응답이면 최종 도구 카드(done)까지 복원해 resume 세션도
          // 새로고침과 동일한 완성 상태가 되게 한다(leg 분할로 최종답변이 다른 leg 에 있던 경우).
          let finalParts: MessagePart[] | undefined;
          for (let i = rows.length - 1; i >= 0; i -= 1) {
            if (rows[i]?.role !== "assistant") continue;
            const raw = rows[i]!.content;
            if (typeof raw === "string") {
              finalContent = raw;
            } else if (
              raw &&
              typeof raw === "object" &&
              Array.isArray((raw as { parts?: unknown }).parts)
            ) {
              const structured = raw as { text?: unknown; parts?: unknown };
              finalContent =
                typeof structured.text === "string" ? structured.text : "";
              finalParts = structured.parts as MessagePart[];
            } else {
              finalContent = raw == null ? "" : JSON.stringify(raw);
            }
            break;
          }
          if (finalContent === null) return false;
          // 텍스트도 파트도 없으면(빈 응답) 보정할 게 없다.
          if (!finalContent && !finalParts) return false;
          const target = assistantId;
          updateNode(target, (m) => {
            // 구조화 파트가 있으면 그걸로 완성 상태를 복원한다(도구 카드 status=done 반영).
            if (finalParts) {
              return { ...m, content: finalContent!, parts: finalParts };
            }
            // 클라이언트가 이미 최종본 이상을 들고 있으면(정상 종단) 덮어쓰지 않는다.
            if (m.content.length >= finalContent!.length) return m;
            const toolParts = (m.parts ?? []).filter((p) => p.type !== "text");
            return {
              ...m,
              content: finalContent!,
              parts: [
                ...toolParts,
                { type: "text", text: finalContent! } as MessagePart,
              ],
            };
          });
          return true;
        } catch {
          return false;
        }
      }

      // resume leg 1회 — 16-API-CONTRACT § GET .../messages/:messageId/stream.
      //   "terminal": 정상 종단(더 이상 재시도 불필요)
      //   "dropped": 종단 없이 leg 이 또 끊김(백그라운드 재전환 등) → 재시도 가능
      //   "gone": 서버 턴이 이미 종료됨(410/404) → 최종 답변 복구 시도로 이어짐
      //   "failed": 네트워크 자체 실패 → 재시도 가능 오류로 사용자에게 알림
      type LegResult = "terminal" | "dropped" | "gone" | "failed";
      async function resumeLeg(): Promise<LegResult> {
        if (!lastServerMessageId) return "failed";
        let res: { ok?: boolean; body?: ReadableStream<Uint8Array> | null };
        try {
          res = await apiFetch(
            `/api/v1/sessions/${sessionId}/messages/${lastServerMessageId}/stream`,
            {
              credentials: "include",
              signal: controller.signal,
              headers: { Accept: "text/event-stream" },
            },
          );
        } catch (err) {
          return (err as Error).name === "AbortError" ? "terminal" : "failed";
        }
        if ("ok" in res && res.ok === false) return "gone";
        try {
          await readFrom(res);
        } catch (err) {
          return (err as Error).name === "AbortError" ? "terminal" : "dropped";
        }
        if (receivedTerminal || controller.signal.aborted) return "terminal";
        return "dropped";
      }

      // 종단 전이면 resume 루프로 이어받는다. 앱 전환을 여러 번 반복하거나 leg 이 반복
      // 드롭돼도 복구되도록 bounded 재시도(무한 루프 방지). gone(서버 턴 종료)이면 최종 답변을
      // 복구하고, 그마저 실패하면 재시도 가능 오류로 알린다.
      async function driveToTerminal(): Promise<void> {
        let drops = 0;
        while (
          !receivedTerminal &&
          !controller.signal.aborted &&
          lastServerMessageId
        ) {
          const result = await resumeLeg();
          if (result === "terminal") return;
          if (result === "gone") {
            if (await recoverFinalMessage()) {
              receivedTerminal = true;
              return;
            }
            emitConnectionError();
            return;
          }
          if (result === "failed") {
            // 최종 답변이 이미 영속됐을 수 있으니 복구를 먼저 시도(무손실 폴백).
            if (await recoverFinalMessage()) {
              receivedTerminal = true;
              return;
            }
            emitConnectionError();
            return;
          }
          // "dropped" — 다시 시도. 연속 드롭이 과하면 알리고 중단.
          drops += 1;
          if (drops >= 12) {
            if (await recoverFinalMessage()) {
              receivedTerminal = true;
              return;
            }
            emitConnectionError();
            return;
          }
        }
      }

      try {
        if (resumeMessageId) {
          // resume 모드 — POST 없이 진행 중 turn 에 재연결한다. placeholder assistant 노드를
          // 만들어 resume 스트림의 message_replace/재생 도구 이벤트/라이브 이벤트를 받도록 한다.
          lastServerMessageId = resumeMessageId;
          assistantId = `local-a-${idCounterRef.current++}`;
          legStartedAt = Date.now();
          addNode(assistantId, userNodeId, {
            id: assistantId,
            role: "assistant",
            content: "",
          });
          await driveToTerminal();
          // leg 분할(deep_research: 도구 leg vs 최종답변 leg)로 최종 텍스트가 resume 대상과
          // 다른 leg 에 있을 수 있다 — 종료 후 영속된 최종답변({text,parts})으로 한 번 더 보정해
          // 완성 상태(최종 답변 + done 도구 카드)를 맞춘다. recoverFinalMessage 는 멱등하다.
          await recoverFinalMessage();
        } else {
          const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
            method: "POST",
            credentials: "include",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream",
            },
            body: JSON.stringify({
              content,
              // P22-T6-04 — 서버 wire format 은 uploadId 만 받는다. 버블 썸네일용
              // filename/mimeType/previewUrl(blob:) 는 여기서 떼고 uploadId 만 보낸다.
              ...(attachments && attachments.length > 0
                ? {
                    attachments: attachments.map((a) => ({
                      uploadId: a.uploadId,
                    })),
                  }
                : {}),
              ...(options?.model ? { model: options.model } : {}),
              ...(options?.mode ? { mode: options.mode } : {}),
              ...(options?.reasoningEffort
                ? { reasoningEffort: options.reasoningEffort }
                : {}),
              ...(options?.webSearch !== undefined
                ? { webSearch: options.webSearch }
                : {}),
              ...(options?.temporary ? { temporary: true } : {}),
            }),
          });

          await readFrom(res);

          if (!receivedTerminal && !controller.signal.aborted) {
            await driveToTerminal();
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          if (lastServerMessageId && !receivedTerminal) {
            await driveToTerminal();
          } else {
            setIsStreaming(false);
          }
        }
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
        abortRef.current = null;
        if (readerRef.current) {
          readerRef.current.cancel().catch(() => {});
          readerRef.current = null;
        }
        // P22-T6-05 — 이 leg 이 끝났으니 대기열 헤드를 FIFO 로 자동 디스패치한다.
        drainQueueRef.current();
      }
    },
    [sessionId, addNode, updateNode],
  );

  // P22-T6-05 — 실제 턴 디스패치(낙관적 유저 버블 추가 + streamTurn). send() 와 큐 드레인이
  // 공유한다. send() 는 스트리밍 중이면 큐잉만 하고, 이 함수는 실제 전송을 담당한다.
  const dispatchSend = useCallback(
    async (
      content: string,
      attachments?: MessageAttachment[],
      options?: SendOptions,
    ) => {
      const tipId = getTipId(treeRef.current);
      const userId = `local-u-${idCounterRef.current++}`;
      // P22-T6-04 — 낙관적 유저 버블에 첨부(이미지는 previewUrl 썸네일)를 함께 실어 렌더한다.
      addNode(userId, tipId, {
        id: userId,
        role: "user",
        content,
        ...(attachments && attachments.length > 0 ? { attachments } : {}),
      });
      await streamTurn(userId, content, attachments, options);
    },
    [addNode, streamTurn],
  );

  const send = useCallback(
    async (
      content: string,
      attachments?: MessageAttachment[],
      options?: SendOptions,
    ) => {
      // P22-T6-05 — 응답 생성 중이면 in-flight leg 을 abort 하지 않고 큐(FIFO)에 쌓는다.
      // 스트림 종료 시 streamTurn.finally 의 drainQueueRef 가 헤드를 자동 디스패치한다.
      if (isStreamingRef.current) {
        queueRef.current.push({
          id: `local-q-${idCounterRef.current++}`,
          content,
          ...(attachments && attachments.length > 0 ? { attachments } : {}),
          ...(options ? { options } : {}),
        });
        syncQueueState();
        return;
      }
      await dispatchSend(content, attachments, options);
    },
    [dispatchSend, syncQueueState],
  );

  // P22-T6-05 — 큐에 쌓인(아직 미전송) 메시지를 취소하면 드롭되어 영구히 전송되지 않는다.
  const removeQueued = useCallback(
    (id: string) => {
      queueRef.current = queueRef.current.filter((q) => q.id !== id);
      syncQueueState();
    },
    [syncQueueState],
  );

  // P22-T6-05 — 스트림 종료 시(streamTurn.finally) 호출되는 드레인. 큐 헤드를 FIFO 로 하나
  // 꺼내 디스패치하고, 그 턴이 끝나면 다시 finally 가 이 함수를 불러 큐가 빌 때까지 이어간다.
  useEffect(() => {
    drainQueueRef.current = () => {
      if (isStreamingRef.current) return;
      const next = queueRef.current.shift();
      if (!next) return;
      syncQueueState();
      void dispatchSend(next.content, next.attachments, next.options);
    };
  }, [dispatchSend, syncQueueState]);

  // loadHistory 가 진행 중 run 을 발견하면 이 ref 로 streamTurn 을 resume 모드로 호출한다
  // (POST 없이 진행 중 messageId 의 스트림에 재연결). streamTurn 정의 이후에 배선한다.
  useEffect(() => {
    resumeActiveRunRef.current = (parentNodeId, messageId) =>
      streamTurn(parentNodeId, "", undefined, undefined, messageId);
  }, [streamTurn]);

  // P22-T6-06 — 단일 모델 비교 leg 하나를 스트리밍한다. 기존 단일경로 POST /messages 엔드포인트를
  // 그대로 재사용하되(모델을 body.model 로 지정), 이벤트를 트리가 아니라 지정된 컬럼 답변에 기록한다.
  // message_start.meta.model 이 이미 모델을 실어오므로 컬럼 구분에 그대로 활용한다.
  const streamCompareLeg = useCallback(
    async (
      groupId: string,
      answerId: string,
      content: string,
      model: string,
      options?: SendOptions,
    ): Promise<void> => {
      const controller = new AbortController();
      compareControllersRef.current.push(controller);
      let legStartedAt: number | null = null;
      let sawTerminal = false;
      try {
        const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
          method: "POST",
          credentials: "include",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            content,
            model,
            ...(options?.mode ? { mode: options.mode } : {}),
            ...(options?.reasoningEffort
              ? { reasoningEffort: options.reasoningEffort }
              : {}),
            ...(options?.webSearch !== undefined
              ? { webSearch: options.webSearch }
              : {}),
          }),
        });
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep = buffer.indexOf("\n\n");
          while (sep !== -1) {
            const frame = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const event = parseSseFrame(frame);
            sep = buffer.indexOf("\n\n");
            if (!event) continue;
            if (event.type === "message_start") {
              legStartedAt = Date.now();
              updateCompareAnswer(groupId, answerId, (a) => ({
                ...a,
                ...(event.meta
                  ? {
                      meta: {
                        provider: event.meta.provider,
                        model: event.meta.model,
                      },
                    }
                  : {}),
              }));
            } else if (event.type === "text_delta") {
              updateCompareAnswer(groupId, answerId, (a) => ({
                ...a,
                content: a.content + event.text,
              }));
            } else if (event.type === "reasoning_delta") {
              updateCompareAnswer(groupId, answerId, (a) => ({
                ...a,
                reasoning: (a.reasoning ?? "") + event.text,
              }));
            } else if (event.type === "stop") {
              if (event.reason !== "tool_use") {
                sawTerminal = true;
                const elapsedMs =
                  legStartedAt !== null ? Date.now() - legStartedAt : undefined;
                updateCompareAnswer(groupId, answerId, (a) => ({
                  ...a,
                  streaming: false,
                  meta: {
                    ...a.meta,
                    ...(elapsedMs !== undefined ? { elapsedMs } : {}),
                    ...(event.usage
                      ? {
                          inputTokens: event.usage.inputTokens,
                          outputTokens: event.usage.outputTokens,
                        }
                      : {}),
                  },
                }));
              }
            } else if (event.type === "error") {
              sawTerminal = true;
              updateCompareAnswer(groupId, answerId, (a) => ({
                ...a,
                streaming: false,
                error: true,
                content:
                  a.content || (event.error?.message ?? "알 수 없는 오류"),
              }));
            }
          }
        }
        // 종단 이벤트 없이 reader 가 끝났으면(드롭) 스트리밍 표시만 정리한다.
        if (!sawTerminal) {
          updateCompareAnswer(groupId, answerId, (a) =>
            a.streaming ? { ...a, streaming: false } : a,
          );
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          updateCompareAnswer(groupId, answerId, (a) => ({
            ...a,
            streaming: false,
          }));
        } else {
          updateCompareAnswer(groupId, answerId, (a) => ({
            ...a,
            streaming: false,
            error: true,
            content: a.content || "연결이 끊어졌습니다. 다시 시도해주세요.",
          }));
        }
      } finally {
        compareControllersRef.current = compareControllersRef.current.filter(
          (c) => c !== controller,
        );
      }
    },
    [sessionId, updateCompareAnswer],
  );

  // P22-T6-06 — 하나의 프롬프트를 N개 모델로 병렬 팬아웃. 각 모델마다 컬럼(초기 답변 1개)을
  // 만들고 Promise.all 로 동시에 스트리밍한다. 모든 leg 이 끝나면 isStreaming 을 내린다.
  const sendCompare = useCallback(
    async (content: string, models: string[], options?: SendOptions) => {
      if (models.length === 0) return;
      const groupId = `cmp-${idCounterRef.current++}`;
      const columns: CompareColumn[] = models.map((m) => ({
        model: m,
        answers: [
          {
            id: `${groupId}-a-${idCounterRef.current++}`,
            content: "",
            streaming: true,
          },
        ],
        activeIndex: 0,
      }));
      setCompareGroupsSynced((prev) => [
        ...prev,
        { id: groupId, userContent: content, columns },
      ]);
      setIsStreaming(true);
      isStreamingRef.current = true;
      try {
        await Promise.all(
          columns.map((col) =>
            streamCompareLeg(
              groupId,
              col.answers[0]!.id,
              content,
              col.model,
              options,
            ),
          ),
        );
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
      }
    },
    [setCompareGroupsSynced, streamCompareLeg],
  );

  // P22-T6-06 — 특정 컬럼(모델)만 재생성: 그 컬럼에 새 형제 답변을 추가하고 활성 인덱스를 그리로
  // 옮긴 뒤 스트리밍한다. 다른 컬럼은 건드리지 않는다(독립 재생성).
  const regenerateCompare = useCallback(
    async (groupId: string, model: string) => {
      const group = compareGroupsRef.current.find((g) => g.id === groupId);
      if (!group) return;
      const answerId = `${groupId}-a-${idCounterRef.current++}`;
      setCompareGroupsSynced((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                columns: g.columns.map((col) =>
                  col.model !== model
                    ? col
                    : {
                        ...col,
                        answers: [
                          ...col.answers,
                          { id: answerId, content: "", streaming: true },
                        ],
                        activeIndex: col.answers.length,
                      },
                ),
              },
        ),
      );
      setIsStreaming(true);
      isStreamingRef.current = true;
      try {
        await streamCompareLeg(groupId, answerId, group.userContent, model);
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
      }
    },
    [setCompareGroupsSynced, streamCompareLeg],
  );

  // P22-T6-06 — 컬럼별 형제 답변 prev/next 네비게이션(다른 컬럼에 영향 없음).
  const switchCompareBranch = useCallback(
    (groupId: string, model: string, direction: "prev" | "next") => {
      setCompareGroupsSynced((prev) =>
        prev.map((g) =>
          g.id !== groupId
            ? g
            : {
                ...g,
                columns: g.columns.map((col) => {
                  if (col.model !== model) return col;
                  const next =
                    direction === "prev"
                      ? col.activeIndex - 1
                      : col.activeIndex + 1;
                  if (next < 0 || next >= col.answers.length) return col;
                  return { ...col, activeIndex: next };
                }),
              },
        ),
      );
    },
    [setCompareGroupsSynced],
  );

  const editMessage = useCallback(
    async (messageId: string, newContent: string) => {
      const t = treeRef.current;
      const target = t.nodes[messageId];
      if (!target || target.role !== "user") return;
      const parentId = t.parentOf[messageId] ?? null;
      const userId = `local-u-${idCounterRef.current++}`;
      addNode(userId, parentId, {
        id: userId,
        role: "user",
        content: newContent,
      });
      await streamTurn(userId, newContent);
    },
    [addNode, streamTurn],
  );

  // P17-T6-03(TS-06) — 재생성은 새 user 턴을 추가하지 않고, 대상 assistant 메시지가
  // 속한 user 턴을 그대로 재사용해 그 user 노드 아래 새 assistant 형제를 만든다(편집/분기와
  // 동일한 tree 의미 — addNode 가 형제 목록에 append+활성 자식 전환까지 처리).
  // error 메시지는 스트리밍 중 만든 빈 assistant placeholder 의 자식으로 추가되므로
  // (emitConnectionError/error 핸들러가 assistantId ?? userNodeId 를 부모로 씀), 재시도 시엔
  // 곧바로 위 부모가 user 가 아닐 수 있어 user 노드를 만날 때까지 부모 체인을 거슬러 올라간다.
  const regenerate = useCallback(
    async (assistantMessageId: string) => {
      const t = treeRef.current;
      let cursor: string | null = t.parentOf[assistantMessageId] ?? null;
      while (cursor) {
        const node = t.nodes[cursor];
        if (node?.role === "user") {
          await streamTurn(cursor, node.content);
          return;
        }
        cursor = t.parentOf[cursor] ?? null;
      }
    },
    [streamTurn],
  );

  // P19-T6-08 — 응답 이어쓰기: 잘린(truncated) assistant 메시지를 대상으로 서버
  // continue 엔드포인트(P19-T2-03)를 호출해, 기존 SSE 파이프(text_delta/stop)를 그대로
  // 재사용하면서 새로 온 text_delta 만 대상 노드의 content 뒤에 이어붙인다(새 노드 생성 X).
  const continueMessage = useCallback(
    async (assistantMessageId: string) => {
      const target = treeRef.current.nodes[assistantMessageId];
      if (!target || target.role !== "assistant") return;

      // P21-T6-12(UX-20/21) — 겹침 가드: 이어쓰기 재호출이 이전 leg 위로 겹치지 않게
      // 먼저 이전 leg 을 abort 한다(streamTurn 과 동일 원칙).
      if (isStreamingRef.current) {
        abortRef.current?.abort();
        if (readerRef.current) {
          readerRef.current.cancel().catch(() => {});
          readerRef.current = null;
        }
      }

      setIsStreaming(true);
      isStreamingRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await apiFetch(
          `/api/v1/sessions/${sessionId}/messages/${assistantMessageId}/continue`,
          {
            method: "POST",
            credentials: "include",
            signal: controller.signal,
            headers: { Accept: "text/event-stream" },
          },
        );
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sepIndex = buffer.indexOf("\n\n");
          while (sepIndex !== -1) {
            const frame = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex + 2);
            const event = parseSseFrame(frame);
            sepIndex = buffer.indexOf("\n\n");
            if (!event) continue;
            if (event.type === "text_delta") {
              updateNode(assistantMessageId, (m) => {
                const parts = m.parts ?? [];
                const last = parts.at(-1);
                const nextParts: MessagePart[] =
                  last?.type === "text"
                    ? [
                        ...parts.slice(0, -1),
                        { type: "text", text: last.text + event.text },
                      ]
                    : [...parts, { type: "text", text: event.text }];
                return {
                  ...m,
                  content: m.content + event.text,
                  parts: nextParts,
                  truncated: false,
                };
              });
            } else if (event.type === "stop") {
              setIsStreaming(false);
              notifyTurnComplete();
            } else if (event.type === "error") {
              setIsStreaming(false);
              showToast("error", event.error?.message ?? "알 수 없는 오류");
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          showToast("error", "연결이 끊어졌습니다. 다시 시도해주세요.");
        }
      } finally {
        setIsStreaming(false);
        isStreamingRef.current = false;
        abortRef.current = null;
      }
    },
    [sessionId, updateNode],
  );

  // P20-T6-05 — 개별 메시지 삭제: 대상 노드+하위 서브트리를 낙관적으로 제거하고
  // DELETE /:id/messages/:messageId(P20-T1-05, 서버가 동일하게 서브트리를 prune)를
  // 호출한다. 삭제된 노드가 활성 자식이었으면 형제(이전 우선)로, 없으면 부모로 재지정한다.
  // 실패 시 삭제 전 스냅샷으로 트리를 통째로 되돌린다(낙관적 롤백).
  //
  // 트리 노드 키는 서버 messageId 와 별개(위 message_start 참고, 항상 local-* 로 새로
  // 발급)이므로, 새로고침 전(라이브 턴) 메시지는 로컬 id 뿐 실제 DB id 를 모른다. 삭제는
  // 실제 DB id 로 요청해야 하므로, local-* 대상은 GET /:id/messages 로 영속된 행을 가져와
  // ROOT 부터의 조상 경로를 형제 순서(인덱스)로 매칭해 실제 id 를 역산한다(추가 SSE
  // 이벤트·interfaces 변경 없이 in-scope 파일만으로 해결).
  const resolveServerMessageId = useCallback(
    async (
      ancestorChain: string[],
      localParentKeyOf: Map<string, string>,
      localSiblingsAt: Map<string, string[]>,
    ): Promise<string | null> => {
      const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data: Array<{ id: string; parentMessageId?: string | null }>;
      };
      const realChildrenOf = new Map<string, string[]>();
      for (const row of body.data) {
        const key = row.parentMessageId ?? ROOT;
        realChildrenOf.set(key, [...(realChildrenOf.get(key) ?? []), row.id]);
      }
      let realParentKey = ROOT;
      let resolved: string | null = null;
      for (const localId of ancestorChain) {
        const parentKey = localParentKeyOf.get(localId) ?? ROOT;
        const localSiblings = localSiblingsAt.get(parentKey) ?? [];
        const idx = localSiblings.indexOf(localId);
        const realSiblings = realChildrenOf.get(realParentKey) ?? [];
        const realId = idx >= 0 ? realSiblings[idx] : undefined;
        if (!realId) return null;
        resolved = realId;
        realParentKey = realId;
      }
      return resolved;
    },
    [sessionId],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const t = treeRef.current;
      if (!t.nodes[messageId]) return;

      const snapshot: TreeData = {
        nodes: { ...t.nodes },
        parentOf: { ...t.parentOf },
        childrenOf: Object.fromEntries(
          Object.entries(t.childrenOf).map(([k, v]) => [k, [...v]]),
        ),
        activeChildOf: { ...t.activeChildOf },
      };

      const ancestorChain: string[] = [];
      {
        let cursor: string | null = messageId;
        while (cursor) {
          ancestorChain.unshift(cursor);
          cursor = t.parentOf[cursor] ?? null;
        }
      }
      const localParentKeyOf = new Map<string, string>();
      const localSiblingsAt = new Map<string, string[]>();
      for (const id of ancestorChain) {
        const parentKey = t.parentOf[id] ?? ROOT;
        localParentKeyOf.set(id, parentKey);
        if (!localSiblingsAt.has(parentKey)) {
          localSiblingsAt.set(parentKey, [...(t.childrenOf[parentKey] ?? [])]);
        }
      }

      const toRemove: string[] = [];
      const stack = [messageId];
      while (stack.length > 0) {
        const id = stack.pop();
        if (id === undefined) continue;
        toRemove.push(id);
        stack.push(...(t.childrenOf[id] ?? []));
      }

      const parentId = t.parentOf[messageId] ?? null;
      const key = parentId ?? ROOT;
      const siblings = t.childrenOf[key] ?? [];
      const idx = siblings.indexOf(messageId);
      const remainingSiblings = siblings.filter((id) => id !== messageId);

      for (const id of toRemove) {
        delete t.nodes[id];
        delete t.parentOf[id];
        delete t.childrenOf[id];
        delete t.activeChildOf[id];
      }
      if (remainingSiblings.length > 0) {
        t.childrenOf[key] = remainingSiblings;
      } else {
        delete t.childrenOf[key];
      }
      if (t.activeChildOf[key] === messageId) {
        const fallback =
          remainingSiblings[Math.max(0, idx - 1)] ?? remainingSiblings[0];
        if (fallback) {
          t.activeChildOf[key] = fallback;
        } else {
          delete t.activeChildOf[key];
        }
      }
      bump();

      try {
        const serverId = messageId.startsWith("local-")
          ? await resolveServerMessageId(
              ancestorChain,
              localParentKeyOf,
              localSiblingsAt,
            )
          : messageId;
        if (!serverId) throw new Error("unresolved message id");
        const res = await apiFetch(
          `/api/v1/sessions/${sessionId}/messages/${serverId}`,
          { method: "DELETE", credentials: "include" },
        );
        if (!res.ok) throw new Error("delete failed");
      } catch {
        treeRef.current = snapshot;
        bump();
        showToast("error", "메시지 삭제에 실패했습니다.");
      }
    },
    [sessionId, bump, resolveServerMessageId],
  );

  const switchBranch = useCallback(
    (messageId: string, direction: "prev" | "next") => {
      const t = treeRef.current;
      const parentId = t.parentOf[messageId];
      if (parentId === undefined) return;
      const key = parentId ?? ROOT;
      const siblings = t.childrenOf[key] ?? [];
      const idx = siblings.indexOf(messageId);
      if (idx === -1) return;
      const nextIdx = direction === "prev" ? idx - 1 : idx + 1;
      if (nextIdx < 0 || nextIdx >= siblings.length) return;
      const nextId = siblings[nextIdx];
      if (!nextId) return;
      t.activeChildOf[key] = nextId;
      bump();
    },
    [bump],
  );

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    // P22-T6-06 — 비교 모드 진행 중이면 모든 컬럼 leg 도 함께 취소한다.
    for (const c of compareControllersRef.current) c.abort();
    compareControllersRef.current = [];
    setIsStreaming(false);
    isStreamingRef.current = false;
    const t = treeRef.current;
    const tipId = getTipId(t);
    if (tipId) {
      const tip = t.nodes[tipId];
      if (tip && tip.role === "assistant") {
        updateNode(tipId, (m) => ({
          ...m,
          content: `${m.content}\n\n[잘림]`,
          truncated: true,
        }));
      }
    }
    await apiFetch(`/api/v1/sessions/${sessionId}/active-run`, {
      method: "DELETE",
      credentials: "include",
    }).catch(() => {});
  }, [sessionId, updateNode]);

  const respondHitl = useCallback(
    async (
      decision: "approved" | "denied",
      modifiedArgs?: Record<string, unknown>,
      reason?: string,
    ) => {
      if (!hitlRequest) return;
      await apiFetch(`/api/v1/sessions/${sessionId}/messages/hitl`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCallId: hitlRequest.toolCallId,
          decision,
          ...(modifiedArgs ? { modifiedArgs } : {}),
          ...(reason ? { reason } : {}),
        }),
      }).catch(() => {});
    },
    [sessionId, hitlRequest],
  );

  return {
    messages,
    isStreaming,
    send,
    // P22-T6-05 — 응답 생성 중 대기열(FIFO)과 취소 핸들.
    queuedMessages,
    removeQueued,
    // P22-T6-06 — 멀티모델 병렬 비교.
    compareGroups,
    sendCompare,
    regenerateCompare,
    switchCompareBranch,
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
  };
}

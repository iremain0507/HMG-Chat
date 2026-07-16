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
import { useCallback, useMemo, useRef, useState } from "react";
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

export interface StreamMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  parts?: MessagePart[];
  truncated?: boolean;
  error?: boolean;
  // P10-T6-17 — SerializedError(§14-INTERFACES) 의 retryable/category 를 그대로 반영.
  // retryable 인 오류만 재시도 버튼을 노출(크레딧부족 등 비재시도 오류는 노출 안 함).
  retryable?: boolean;
  errorCategory?: string;
  citations?: Citation[];
  branch?: MessageBranch;
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
export interface ArtifactSummary {
  artifactId: string;
  artifactKind: string;
  filename: string;
  sizeBytes: number;
  downloadUrl?: string;
}

// P10-T6-13 — 모델/모드 피커 선택값. 서버 계약(16-API-CONTRACT § POST /sessions/:id/messages)에
// 아직 없는 필드라 서버는 무시하지만(attachments 와 동일하게 알 수 없는 키는 c.req.json<{...}>()
// 파싱에서 그냥 버려짐), acceptance("선택이 전송 payload 반영")를 위해 body 에 포함해 전달한다.
export interface SendOptions {
  model?: string;
  mode?: "agent" | "chat";
  reasoningEffort?: "low" | "medium" | "high";
  webSearch?: boolean;
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
  const abortRef = useRef<AbortController | null>(null);

  // P17-T6-01(TS-08) — 세션 재진입/새로고침 시 GET /:id/messages 로 과거 대화를 복원한다.
  // 서버는 각 turn 의 user+assistant 메시지를 생성 시각순으로 반환(P17-T1-01/02) — 편집/재생성으로
  // 생긴 형제 분기까지는 구분하지 않으므로(parentMessageId 미포함), 단일 선형 체인으로 복원한다.
  // 이미 로컬에 진행 중인 대화(예: 새 세션에서 첫 메시지를 보낸 직후)가 있으면 덮어쓰지 않는다.
  const loadHistory = useCallback(async () => {
    if (historyLoadedRef.current) return;
    if (Object.keys(treeRef.current.nodes).length > 0) return;
    historyLoadedRef.current = true;
    setHistoryLoading(true);
    try {
      const res = await apiFetch(`/api/v1/sessions/${sessionId}/messages`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const body = (await res.json()) as {
        data: Array<{ id: string; role: string; content: unknown }>;
      };
      let parentId: string | null = null;
      for (const row of body.data) {
        if (row.role !== "user" && row.role !== "assistant") continue;
        const content =
          typeof row.content === "string"
            ? row.content
            : row.content == null
              ? ""
              : JSON.stringify(row.content);
        addNode(row.id, parentId, { id: row.id, role: row.role, content });
        parentId = row.id;
      }
    } catch {
      // fail-soft — 히스토리 복원 실패 시 빈 대화로 시작(L2/L5, 조용한 실패 아닌 정상 폴백).
    } finally {
      setHistoryLoading(false);
    }
  }, [sessionId, addNode]);

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
      attachments?: Array<{ uploadId: string }>,
      options?: SendOptions,
    ) => {
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantId: string | null = null;
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
          addNode(assistantId, userNodeId, {
            id: assistantId,
            role: "assistant",
            content: "",
          });
        } else if (event.type === "message_replace" && assistantId) {
          // resume 스트림의 첫 이벤트 — 지금까지 누적된 content 로 동기화.
          updateNode(assistantId, (m) => ({
            ...m,
            content: event.contentSoFar,
            parts: event.contentSoFar
              ? [{ type: "text", text: event.contentSoFar }]
              : [],
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
          updateNode(assistantId, (m) => ({
            ...m,
            parts: [
              ...(m.parts ?? []),
              {
                type: "tool",
                toolCallId: event.toolCallId,
                name: event.name,
                args: event.args,
                status: "running",
              },
            ],
          }));
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
            processEvent(event);
          }
        }
      }

      // 마지막 messageId 로 resume endpoint 에 1회 재연결을 시도한다(16-API-CONTRACT §
      // GET .../messages/:messageId/stream). 재연결도 실패하면 재시도 가능(retryable:true)
      // 오류로 사용자에게 알린다 — 무한 재시도로 루프하지 않는다.
      async function attemptReconnect(): Promise<void> {
        if (!lastServerMessageId) return;
        try {
          const res = await apiFetch(
            `/api/v1/sessions/${sessionId}/messages/${lastServerMessageId}/stream`,
            {
              credentials: "include",
              signal: controller.signal,
              headers: { Accept: "text/event-stream" },
            },
          );
          if ("ok" in res && res.ok === false) {
            emitConnectionError();
            return;
          }
          await readFrom(res);
          if (!receivedTerminal && !controller.signal.aborted) {
            emitConnectionError();
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError") {
            emitConnectionError();
          }
        }
      }

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
            ...(attachments && attachments.length > 0 ? { attachments } : {}),
            ...(options?.model ? { model: options.model } : {}),
            ...(options?.mode ? { mode: options.mode } : {}),
            ...(options?.reasoningEffort
              ? { reasoningEffort: options.reasoningEffort }
              : {}),
            ...(options?.webSearch !== undefined
              ? { webSearch: options.webSearch }
              : {}),
          }),
        });

        await readFrom(res);

        if (!receivedTerminal && !controller.signal.aborted) {
          await attemptReconnect();
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          if (lastServerMessageId && !receivedTerminal) {
            await attemptReconnect();
          } else {
            setIsStreaming(false);
          }
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [sessionId, addNode, updateNode],
  );

  const send = useCallback(
    async (
      content: string,
      attachments?: Array<{ uploadId: string }>,
      options?: SendOptions,
    ) => {
      const tipId = getTipId(treeRef.current);
      const userId = `local-u-${idCounterRef.current++}`;
      addNode(userId, tipId, { id: userId, role: "user", content });
      await streamTurn(userId, content, attachments, options);
    },
    [addNode, streamTurn],
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
    setIsStreaming(false);
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
    stop,
    hitlRequest,
    respondHitl,
    artifacts,
    editMessage,
    regenerate,
    switchBranch,
    historyLoading,
    loadHistory,
  };
}

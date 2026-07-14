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

export type ToolCallStatus = "queued" | "running" | "done" | "error";

export type MessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      toolCallId: string;
      name: string;
      args: unknown;
      status: ToolCallStatus;
      result?: string | unknown;
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
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown }
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
  | { type: "error"; error: { code: string; message: string } };

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
  const abortRef = useRef<AbortController | null>(null);

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

      try {
        const res = await fetch(`/api/v1/sessions/${sessionId}/messages`, {
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

            if (event.type === "message_start") {
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
              setIsStreaming(false);
            } else if (event.type === "error") {
              const message = event.error?.message ?? "알 수 없는 오류";
              const errId = `local-err-${idCounterRef.current++}`;
              addNode(errId, assistantId ?? userNodeId, {
                id: errId,
                role: "assistant",
                content: message,
                error: true,
              });
              setIsStreaming(false);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setIsStreaming(false);
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
    await fetch(`/api/v1/sessions/${sessionId}/active-run`, {
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
      await fetch(`/api/v1/sessions/${sessionId}/messages/hitl`, {
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
    switchBranch,
  };
}

import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolResult,
  ChatEvent,
  ContentPart,
  HitlDecision,
  LLMMessage,
  LLMProvider,
  PromptBlock,
  ToolContext,
} from "@wchat/interfaces";

export function hello(): string {
  return "orchestrator: hello-world";
}

export interface RunTurnInput {
  provider: LLMProvider;
  model: string;
  systemBlocks: PromptBlock[];
  messages: LLMMessage[];
  maxTokens: number;
  signal: AbortSignal;
  tools?: AgentTool[];
  // tools 사용 시 필수 — AgentTool.invoke 에 넘길 ToolContext. signal 은
  // RunTurnInput.signal 을 그대로 쓰므로 여기 별도 필드 없음(중복 방지).
  toolContext?: Omit<ToolContext, "signal">;
  // provider.chat 에 그대로 forward (ChatInput.parallelToolCalls, 14-INTERFACES §6).
  // 이 값과 무관하게 runTurn 자체의 tool-execution 루프는 항상 allow 정책 툴을
  // Promise.all 로 동시 invoke 한다(20-MULTI-AGENT-TOOL.md §20.4-4) — 이 필드는
  // provider 가 모델에게 병렬 tool_use 생성을 허용할지 여부만 제어.
  parallelToolCalls?: boolean;
}

function toToolResultContent(result: AgentToolResult): string | unknown {
  switch (result.content.kind) {
    case "text":
      return result.content.text;
    case "json":
      return result.content.data;
    case "file":
      return { artifactId: result.content.artifactId };
    case "error":
      return { error: result.content.error };
  }
}

type CitationPayload = Omit<Extract<ChatEvent, { type: "citation" }>, "type">;

// knowledge_search 등 검색 툴이 json 결과에 { citations: [...] } 형태를 담아 반환하면
// (apps/server/src/tools/handlers/knowledge-search-handler.ts, P10-T2-03) 각 항목을
// citation ChatEvent 로 펼쳐 emit — 신규 ChatEvent 변형 없이 기존 tool_result json 페이로드
// 형태를 detect 하는 방식 (14-INTERFACES.md 의 12변형 동결 준수).
function extractCitations(data: unknown): CitationPayload[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { citations?: unknown }).citations)
  ) {
    return [];
  }
  return (data as { citations: CitationPayload[] }).citations;
}

type ArtifactCreatedPayload = Omit<
  Extract<ChatEvent, { type: "artifact_created" }>,
  "type"
>;

// artifact-create 등 아티팩트 생성 툴이 json 결과에 { artifact: {...} } 형태를 담아 반환하면
// (apps/server/src/tools/handlers/artifact-create-handler.ts, P10-T2-04) artifact_created
// ChatEvent 로 펼쳐 emit — extractCitations 와 동일한 duck-typing 방식(신규 ChatEvent 변형 없음).
function extractArtifact(data: unknown): ArtifactCreatedPayload | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const artifact = (data as { artifact?: unknown }).artifact;
  if (typeof artifact !== "object" || artifact === null) {
    return undefined;
  }
  const a = artifact as Record<string, unknown>;
  if (
    typeof a.artifactId !== "string" ||
    typeof a.artifactKind !== "string" ||
    typeof a.filename !== "string" ||
    typeof a.sizeBytes !== "number"
  ) {
    return undefined;
  }
  return {
    artifactId: a.artifactId,
    artifactKind: a.artifactKind,
    filename: a.filename,
    sizeBytes: a.sizeBytes,
    ...(typeof a.downloadUrl === "string"
      ? { downloadUrl: a.downloadUrl }
      : {}),
  };
}

// 메시지 → LLM → SSE 루프 (14-INTERFACES.md § 6 ChatEvent 는 16-API-CONTRACT SSE
// 이벤트와 1:1이므로, 이 async generator 를 그대로 SSE 로 relay 하면 된다).
// tools 등록 시: provider.chat 이 stop.reason==="tool_use" 로 끝나면(비종결) 해당
// tool_use 들을 실행해 tool_result 를 emit 하고, 결과를 메시지에 append 해 provider.chat
// 을 재호출한다. abort 된 경우 진행 중이던 tool 실행은 시작하지 않는다.
export async function* runTurn(input: RunTurnInput): AsyncIterable<ChatEvent> {
  const toolsByName = new Map(
    (input.tools ?? []).map((tool) => [tool.spec.name, tool]),
  );
  const toolSpecs = input.tools?.map((tool) => tool.spec);
  let messages = input.messages;

  for (;;) {
    const pendingToolUses: Extract<ChatEvent, { type: "tool_use" }>[] = [];
    const assistantParts: ContentPart[] = [];
    let stopEvent: Extract<ChatEvent, { type: "stop" }> | undefined;

    const chatEvents = input.provider.chat(
      {
        model: input.model,
        systemBlocks: input.systemBlocks,
        messages,
        maxTokens: input.maxTokens,
        ...(toolSpecs ? { tools: toolSpecs } : {}),
        ...(input.parallelToolCalls !== undefined
          ? { parallelToolCalls: input.parallelToolCalls }
          : {}),
      },
      input.signal,
    );
    for await (const event of chatEvents) {
      if (event.type === "text_delta") {
        yield event;
        const last = assistantParts.at(-1);
        if (last?.type === "text") {
          last.text += event.text;
        } else {
          assistantParts.push({ type: "text", text: event.text });
        }
      } else if (event.type === "tool_use") {
        pendingToolUses.push(event);
        assistantParts.push({
          type: "tool_use",
          toolCallId: event.toolCallId,
          name: event.name,
          args: event.args,
        });
        // hitl 정책 툴은 승인 후에만 tool_use 를 emit (16-API-CONTRACT § sub-state 표
        // "streaming → waiting_hitl | tool_use(policy=hitl) | hitl_request(tool_use 는
        // approved 후에 emit)"). allow 정책은 기존과 동일하게 즉시 emit.
        if (toolsByName.get(event.name)?.spec.defaultPolicy !== "hitl") {
          yield event;
        }
      } else if (event.type === "stop") {
        yield event;
        stopEvent = event;
      } else if (event.type === "error") {
        yield event;
        return;
      } else {
        yield event;
      }
    }

    if (stopEvent?.reason !== "tool_use" || pendingToolUses.length === 0) {
      return;
    }
    if (input.signal.aborted) {
      return;
    }

    // hitl 정책 툴은 승인 순서를 보존해야 하므로 각자 단독 세그먼트, 그 외(allow/미등록)
    // 툴은 인접한 것끼리 묶어 세그먼트 단위로 Promise.all 동시 invoke (20-MULTI-AGENT-TOOL.md
    // §20.4-4 "병렬은 allow-툴만, HITL 은 직렬"). 세그먼트를 원래 tool_use 순서대로 처리하고
    // 세그먼트 내부도 원래 순서로 tool_result 를 emit 하므로 완료(resolve) 순서와 무관하게
    // toolResultParts 는 항상 pendingToolUses 와 동일한 순서·id 로 정합된다.
    type ToolUseEvent = Extract<ChatEvent, { type: "tool_use" }>;
    type Segment =
      | { kind: "allow"; items: ToolUseEvent[] }
      | { kind: "hitl"; item: ToolUseEvent };
    const segments: Segment[] = [];
    for (const toolUse of pendingToolUses) {
      if (toolsByName.get(toolUse.name)?.spec.defaultPolicy === "hitl") {
        segments.push({ kind: "hitl", item: toolUse });
        continue;
      }
      const last = segments.at(-1);
      if (last?.kind === "allow") {
        last.items.push(toolUse);
      } else {
        segments.push({ kind: "allow", items: [toolUse] });
      }
    }

    async function invokeAllow(
      toolUse: ToolUseEvent,
    ): Promise<{ toolUse: ToolUseEvent; result: AgentToolResult }> {
      const tool = toolsByName.get(toolUse.name);
      const args = (toolUse.args ?? {}) as Record<string, unknown>;
      const result: AgentToolResult = tool
        ? await tool.invoke({
            toolCallId: toolUse.toolCallId,
            args,
            ctx: { ...input.toolContext!, signal: input.signal },
          })
        : {
            toolCallId: toolUse.toolCallId,
            content: {
              kind: "error",
              error: new WChatError(
                "TOOL_NOT_FOUND",
                "tool",
                false,
                `등록되지 않은 툴: ${toolUse.name}`,
              ),
            },
          };
      return { toolUse, result };
    }

    const toolResultParts: ContentPart[] = [];
    for (const segment of segments) {
      if (segment.kind === "allow") {
        const invoked = await Promise.all(segment.items.map(invokeAllow));
        for (const { toolUse, result } of invoked) {
          const content = toToolResultContent(result);
          yield {
            type: "tool_result",
            toolCallId: toolUse.toolCallId,
            content,
          };
          toolResultParts.push({
            type: "tool_result",
            toolCallId: toolUse.toolCallId,
            content,
          });
          if (result.content.kind === "json") {
            for (const citation of extractCitations(result.content.data)) {
              yield { type: "citation", ...citation };
            }
            const artifact = extractArtifact(result.content.data);
            if (artifact) {
              yield { type: "artifact_created", ...artifact };
            }
          }
        }
        continue;
      }

      const toolUse = segment.item;
      const tool = toolsByName.get(toolUse.name)!;
      let args = (toolUse.args ?? {}) as Record<string, unknown>;
      let skipReason: "denied" | "timeout" | undefined;

      const toolCallId = toolUse.toolCallId;
      const timeoutMs = 300_000;
      const rationale = `"${tool.spec.name}" 실행에는 사용자 승인이 필요합니다: ${tool.spec.description}`;
      const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
      yield {
        type: "hitl_request",
        toolCallId,
        toolName: tool.spec.name,
        args,
        rationale,
        expiresAt,
      };

      let decision: HitlDecision;
      try {
        decision = await input.toolContext!.hitl.askApproval(
          {
            sessionId: input.toolContext!.sessionId,
            toolCallId,
            toolName: tool.spec.name,
            args,
            rationale,
            timeoutMs,
          },
          input.signal,
        );
      } catch {
        // abort 중 HITL 대기 취소 — 진행 중이던 turn 을 즉시 종료.
        return;
      }

      if (decision.kind === "timeout") {
        yield { type: "hitl_timeout", toolCallId };
        skipReason = "timeout";
      } else {
        yield {
          type: "hitl_resolved",
          toolCallId,
          decision: decision.kind,
          ...(decision.kind === "approved" && decision.modifiedArgs
            ? { modifiedArgs: decision.modifiedArgs }
            : {}),
          ...(decision.kind === "denied" && decision.reason
            ? { reason: decision.reason }
            : {}),
        };
        if (decision.kind === "denied") {
          skipReason = "denied";
        } else {
          args = decision.modifiedArgs ?? args;
          yield { type: "tool_use", toolCallId, name: tool.spec.name, args };
        }
      }

      if (skipReason) {
        const content = { hitl: skipReason };
        toolResultParts.push({
          type: "tool_result",
          toolCallId: toolUse.toolCallId,
          content,
        });
        continue;
      }

      const result = await tool.invoke({
        toolCallId: toolUse.toolCallId,
        args,
        ctx: { ...input.toolContext!, signal: input.signal },
      });
      const content = toToolResultContent(result);
      yield { type: "tool_result", toolCallId: toolUse.toolCallId, content };
      toolResultParts.push({
        type: "tool_result",
        toolCallId: toolUse.toolCallId,
        content,
      });
      if (result.content.kind === "json") {
        for (const citation of extractCitations(result.content.data)) {
          yield { type: "citation", ...citation };
        }
        const artifact = extractArtifact(result.content.data);
        if (artifact) {
          yield { type: "artifact_created", ...artifact };
        }
      }
    }

    messages = [
      ...messages,
      { role: "assistant", content: assistantParts },
      { role: "tool", content: toolResultParts },
    ];
  }
}

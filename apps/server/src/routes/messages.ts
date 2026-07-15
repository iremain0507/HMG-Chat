// routes/messages.ts — 16-API-CONTRACT.md § 3 Messages (`POST /sessions/:id/messages`, SSE)
// + `GET /sessions/:id/messages/:messageId/stream`(resume) 단일 출처.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  WChatError,
  type ActiveRunStatus,
  type AgentTool,
  type BudgetClaim,
  type HitlBridge,
  type LLMMessage,
  type LLMProvider,
  type Logger,
  type Organization,
  type PromptBlock,
  type ToolContext,
  type ToolMetricRepo,
} from "@wchat/interfaces";
import { runTurn } from "../orchestrator/orchestrator.js";
import { registerRun, unregisterRun } from "../orchestrator/run-registry.js";
import {
  startMessageRun,
  recordMessageRunEvent,
  subscribeMessageRun,
} from "../orchestrator/message-run-registry.js";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import { hitlBridge } from "../tools/hitl-manager.js";
import { createLogger } from "../lib/logger.js";

// abort flow (L06) — Stop 클릭(routes/sessions.ts DELETE /:id/active-run) 이 run-registry 를 통해
// 이 run 의 signal 을 abort() 시킨 뒤, 여기서 sessions_active_runs.status 를 갱신한다.
// 실제 DB 구현(db/active-runs-service.ts) 연결은 app.ts 조립 시점 소관 — P2-T2-04 와 동일 사유로 이번 태스크 범위 밖.
export interface ActiveRunsPort {
  setActiveRun(
    sessionId: string,
    jobId: string,
    status: ActiveRunStatus,
  ): Promise<void>;
}

const noopActiveRuns: ActiveRunsPort = {
  async setActiveRun() {
    // 기본값 — deps.activeRuns 미주입 시 아무 것도 하지 않는다.
  },
};

// P10-T2-06 — attachments:[{uploadId}] 의 ephemeral RAG 컨텍스트 조회 포트.
// 16-API-CONTRACT § POST /sessions/:id/messages 의 parser-pipeline/chunker/embedding
// 전체 인덱싱(ephemeral_chunks, 0014_uploads.sql)은 knowledge/**(T3) 소유라 이 태스크
// 범위 밖 — 여기선 uploadId → filename 만 조회해 system 블록에 "검색 가능" 안내를 추가한다.
// (knowledge_search 툴이 실제 인덱스 조회는 담당, P10-T2-03 KnowledgeRetrievalPort 와 동일 DI 패턴.)
export interface AttachmentsPort {
  resolveEphemeralContext(
    uploadId: string,
  ): Promise<{ filename: string } | null>;
}

const noopAttachments: AttachmentsPort = {
  async resolveEphemeralContext() {
    return null;
  },
};

// P11-T2-02 — 라우트가 매 요청마다 (필요 시) 조립하는 tool 실행 예산. BudgetClaim
// (14-INTERFACES.md § 10) 의 최소 in-memory 구현 — 단일 누적 카운터만 유지하며 claim
// 이력 스택은 두지 않는다(현재 어떤 tool handler 도 ctx.budget 을 소비하지 않음). 배포 시
// db/quota-store.ts + Redis 카운터로 교체(BudgetClaim.ts 주석과 동일 방침).
function createBudgetClaim(limitMicros: number | null): BudgetClaim {
  let used = 0;
  return {
    async claim(estimateMicros) {
      if (limitMicros !== null && used + estimateMicros > limitMicros) {
        throw new WChatError(
          "QUOTA_EXCEEDED",
          "rate-limit",
          false,
          "툴 실행 예산을 초과했습니다.",
        );
      }
      used += estimateMicros;
    },
    async settle(actualMicros) {
      used += actualMicros;
    },
    async refund() {
      used = 0;
    },
    get remaining() {
      return limitMicros === null
        ? Number.POSITIVE_INFINITY
        : limitMicros - used;
    },
  };
}

export interface MessageRouteDeps {
  provider: LLMProvider;
  model: string;
  systemBlocks?: PromptBlock[];
  maxTokens?: number;
  activeRuns?: ActiveRunsPort;
  attachments?: AttachmentsPort;
  // P11-T2-02 — 내장 handler 로 조립된 정적 AgentTool[](artifact_create 등, app.ts 조립).
  tools?: AgentTool[];
  // org 소유 MCP 서버 발견 결과를 AgentTool[] 로 조립(org 경계 밖 서버 유출 방지 위해
  // per-request 로 호출 — bridge.listRegisteredTools() 는 org 필터가 없는 전역 registry).
  mcpTools?: (orgId: string) => Promise<AgentTool[]>;
  organizations?: { byId(id: string): Promise<Organization | null> };
  hitl?: HitlBridge;
  logger?: Logger;
  // P11-T2-13 — 각 tool invoke 계측(tool-metrics 기록 + gen_ai.* span). 미주입 시 계측 생략.
  toolMetrics?: Pick<ToolMetricRepo, "append">;
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createMessageRoutes(
  deps: MessageRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/:id/messages", async (c) => {
    const body = await c.req
      .json<{
        content?: string;
        attachments?: Array<{ uploadId: string }>;
        model?: string;
      }>()
      .catch(
        () =>
          ({}) as {
            content?: string;
            attachments?: Array<{ uploadId: string }>;
            model?: string;
          },
      );
    const content = body.content?.trim();
    if (!content) {
      return c.json(errorJson("INVALID_INPUT", "content 가 필요합니다."), 400);
    }
    // P10-T2-06 — attachments:[{uploadId}] 를 ephemeral RAG 컨텍스트로 수용
    // (16-API-CONTRACT § POST /sessions/:id/messages 의 Phase 2/4 boundary 조기 해제).
    const attachmentsPort = deps.attachments ?? noopAttachments;
    const resolvedAttachments = await Promise.all(
      (body.attachments ?? []).map((a) =>
        attachmentsPort.resolveEphemeralContext(a.uploadId),
      ),
    );
    const attachmentFilenames = resolvedAttachments
      .filter((a): a is { filename: string } => a !== null)
      .map((a) => a.filename);

    const systemBlocks = deps.systemBlocks ?? [];
    const ephemeralBlock: PromptBlock[] =
      attachmentFilenames.length > 0
        ? [
            {
              tier: "user",
              content: `다음 첨부 문서 검색 가능: ${attachmentFilenames.join(", ")}`,
              cacheControl: "ephemeral",
            },
          ]
        : [];

    const messages: LLMMessage[] = [{ role: "user", content }];

    const sessionId = c.req.param("id");

    // P11-T2-02 — 내장 handler+MCP 툴을 AgentTool[] 로 조립해 runTurn 에 tools+toolContext
    // 주입 + body.model 을 org.allowedModels 화이트리스트로 검증해 실 turn model 로 반영.
    // 기존 테스트(auth/tools/model 미사용)는 이 분기에 전혀 들어오지 않아 그대로 통과한다.
    const requestedModel = body.model;
    const staticTools = deps.tools ?? [];
    const needsToolContext =
      staticTools.length > 0 || deps.mcpTools !== undefined;
    let model = deps.model;
    let tools: AgentTool[] = staticTools;
    let toolContext: Omit<ToolContext, "signal"> | undefined;

    if (requestedModel !== undefined || needsToolContext) {
      const auth = c.get("auth");
      if (!auth) {
        return c.json(errorJson("UNAUTHENTICATED", "인증이 필요합니다."), 401);
      }
      const org = deps.organizations
        ? await deps.organizations.byId(auth.org)
        : null;

      if (requestedModel !== undefined) {
        if (!org || !org.allowedModels.includes(requestedModel)) {
          return c.json(
            errorJson(
              "MODEL_NOT_ALLOWED",
              `허용되지 않은 모델입니다: ${requestedModel}`,
            ),
            400,
          );
        }
        model = requestedModel;
      }

      if (needsToolContext) {
        if (deps.mcpTools) {
          tools = [...staticTools, ...(await deps.mcpTools(auth.org))];
        }
        const requestId = randomUUID();
        toolContext = {
          requestId,
          userId: auth.sub,
          orgId: auth.org,
          sessionId,
          logger: (deps.logger ?? createLogger()).child({
            requestId,
            userId: auth.sub,
            orgId: auth.org,
          }),
          hitl: deps.hitl ?? hitlBridge,
          budget: createBudgetClaim(org?.defaultTokenBudgetMicros ?? null),
        };
      }
    }

    const jobId = randomUUID();
    const activeRuns = deps.activeRuns ?? noopActiveRuns;
    const handle = registerRun(sessionId, jobId);
    const requestSignal = c.req.raw.signal;
    if (requestSignal.aborted) {
      handle.controller.abort();
    } else {
      requestSignal.addEventListener("abort", () => handle.controller.abort(), {
        once: true,
      });
    }

    return streamSSE(c, async (stream) => {
      // GET resume 엔드포인트(message-run-registry.ts)가 캐치업할 수 있도록, 현재 leg 의
      // messageId(message_start 로 파악) 기준으로 매 event 를 기록한다. tool_use 로 인한
      // 재호출로 leg 가 여러 개 생기면 그때마다 message_start 가 새 messageId 를 발급하므로
      // currentMessageId 도 그에 맞춰 갱신된다.
      let currentMessageId: string | undefined;
      try {
        const events = runTurn({
          provider: deps.provider,
          model,
          systemBlocks: [...systemBlocks, ...ephemeralBlock],
          messages,
          maxTokens: deps.maxTokens ?? 1024,
          signal: handle.controller.signal,
          ...(tools.length > 0 ? { tools, parallelToolCalls: true } : {}),
          ...(toolContext ? { toolContext } : {}),
          ...(deps.toolMetrics ? { toolMetrics: deps.toolMetrics } : {}),
        });
        for await (const event of events) {
          if (event.type === "message_start") {
            currentMessageId = event.messageId;
            startMessageRun(event.messageId, sessionId);
          } else if (currentMessageId) {
            recordMessageRunEvent(currentMessageId, event);
          }
          const { type, ...payload } = event;
          await stream.writeSSE({ event: type, data: JSON.stringify(payload) });
        }
        await activeRuns.setActiveRun(
          sessionId,
          jobId,
          handle.controller.signal.aborted ? "cancelled" : "completed",
        );
      } finally {
        unregisterRun(sessionId, jobId);
      }
    });
  });

  // resume 후 재연결 — stop reason='tool_use' 뒤 또는 네트워크 재연결. 첫 event 는 항상
  // message_replace(contentSoFar 로 캐치업) 후 이어지는 live event 를 relay(단일 구독,
  // 동시 구독은 409).
  app.get("/:id/messages/:messageId/stream", (c) => {
    const sessionId = c.req.param("id");
    const messageId = c.req.param("messageId");
    const subscription = subscribeMessageRun(messageId, sessionId);

    if (subscription.kind === "not_found") {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    if (subscription.kind === "gone") {
      return c.json(errorJson("GONE", "이미 종료된 메시지입니다."), 410);
    }
    if (subscription.kind === "conflict") {
      return c.json(
        errorJson("CONCURRENT_RUN", "이미 다른 클라이언트가 구독 중입니다."),
        409,
      );
    }

    return streamSSE(c, async (stream) => {
      const requestSignal = c.req.raw.signal;
      const onAbort = () => subscription.unsubscribe();
      requestSignal.addEventListener("abort", onAbort, { once: true });
      try {
        await stream.writeSSE({
          event: "message_replace",
          data: JSON.stringify({
            messageId,
            contentSoFar: subscription.contentSoFar,
          }),
        });
        for await (const event of subscription.events) {
          const { type, ...payload } = event;
          await stream.writeSSE({ event: type, data: JSON.stringify(payload) });
        }
      } finally {
        requestSignal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();
      }
    });
  });

  return app;
}

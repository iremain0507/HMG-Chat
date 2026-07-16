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
import {
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../lib/org-settings-schema.js";

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

// P14-T2-01 — org 별 maxTokens/temperature(ISOLATE, runtime 미배선)/systemPrompt/defaultModel
// 을 admin 이 조정한 값으로 조회하는 포트. settings-service.ts(T1)와 동일 계약(resolve)만
// 의존해 messages.ts 는 org-settings-schema.ts 의 타입만 import 한다(DI, 순환 회피).
export interface SettingsResolverPort {
  resolve(orgId: string): Promise<ResolvedOrgSettings>;
}

// org-settings-schema.ts 의 OrgSettingsSchema 필드는 전부 zod `.optional()` 이라
// ResolvedOrgSettings(=Required<OrgSettingsPatch>) 로도 `string | undefined` 타입이 남는다
// (Required<> 는 `?` modifier 만 제거, union 의 `| undefined` 는 유지되는 TS 특성). 아래
// 안전기본 리터럴(4096)은 그 잔여 `| undefined` 를 좁히기 위한 최종 non-null 보강이며,
// DEFAULT_ORG_SETTINGS.maxTokens 와 항상 같은 값을 유지해야 한다.
const SAFE_DEFAULT_MAX_TOKENS = 4096;

// 트리거 버그(messages.ts:272 구 `?? 1024`) 근본해결 — resolve 가 없거나(deps.settings
// 미주입)/인증이 없거나/조회가 실패(reject)해도 절대 throw 하지 않고 DEFAULT_ORG_SETTINGS
// (maxTokens=4096)로 fail-soft 한다(21-LOOP-LESSONS.md L2/L5 — 구 1024 폴백 금지).
async function resolveSettingsSafely(
  settings: SettingsResolverPort | undefined,
  orgId: string | undefined,
  logger: Logger | undefined,
): Promise<ResolvedOrgSettings> {
  if (!settings || !orgId) return DEFAULT_ORG_SETTINGS;
  try {
    return await settings.resolve(orgId);
  } catch (error) {
    logger?.warn({
      category: "system",
      msg: "org settings resolve 실패 — DEFAULT_ORG_SETTINGS 로 폴백",
      orgId,
      context: { error: String(error) },
    });
    return DEFAULT_ORG_SETTINGS;
  }
}

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
  // 클라이언트 생성 세션 UUID(/chat/<uuid>)로 바로 메시지를 보내는 흐름에서, 아티팩트
  //   /업로드/active-run 이 참조하는 sessions 행이 없으면 FK 위반이 난다(deep_research 리포트
  //   저장 실패 등). 첫 메시지 시 세션을 보장(upsert)한다. 미주입 시 no-op(기존 동작).
  ensureSession?: (sessionId: string, userId: string) => Promise<void>;
  hitl?: HitlBridge;
  logger?: Logger;
  // P11-T2-13 — 각 tool invoke 계측(tool-metrics 기록 + gen_ai.* span). 미주입 시 계측 생략.
  toolMetrics?: Pick<ToolMetricRepo, "append">;
  // P14-T2-01 — org-scoped admin 설정(maxTokens/systemPrompt/defaultModel) 조회. 미주입 시
  // DEFAULT_ORG_SETTINGS 로 fail-soft(기존 동작 보존 + 구 1024 폴백은 여전히 제거됨).
  settings?: SettingsResolverPort;
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
    // 클라이언트 생성 세션 UUID 를 첫 메시지 시 DB 에 보장(upsert) — 이후 아티팩트/업로드/
    //   active-run 의 sessions FK 를 충족(없으면 deep_research 리포트 저장 등이 FK 위반).
    const auth = c.get("auth");
    if (auth) {
      await deps.ensureSession?.(c.req.param("id"), auth.sub);
    }

    const content = body.content?.trim();
    if (!content) {
      return c.json(errorJson("INVALID_INPUT", "content 가 필요합니다."), 400);
    }

    // P14-T2-01 — org-scoped admin 설정 조회(maxTokens/systemPrompt/defaultModel). 인증이
    // 없거나 deps.settings 미주입/조회 실패 시 DEFAULT_ORG_SETTINGS 로 fail-soft.
    const resolvedSettings = await resolveSettingsSafely(
      deps.settings,
      auth?.org,
      deps.logger,
    );
    const settingsResolved = deps.settings !== undefined && auth !== undefined;

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

    // org systemPrompt 를 system-tier PromptBlock 로 기존 systemBlocks 맨 앞에 추가한다
    // (16-API-CONTRACT 의 tier 우선순위: system > project > user).
    const orgSystemBlock: PromptBlock[] = resolvedSettings.systemPrompt
      ? [{ tier: "system", content: resolvedSettings.systemPrompt }]
      : [];
    const systemBlocks = [...orgSystemBlock, ...(deps.systemBlocks ?? [])];
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
    // P14-T2-01 — org defaultModel 은 body.model 이 없을 때만, 실제 org 설정이 조회됐을 때만
    // (settingsResolved) deps.model(서버 기본 모델)을 대체한다 — settings 미주입 환경(기존
    // 테스트/배선)은 deps.model 그대로 유지.
    let model =
      requestedModel === undefined && settingsResolved
        ? (resolvedSettings.defaultModel ?? deps.model)
        : deps.model;
    let tools: AgentTool[] = staticTools;
    let toolContext: Omit<ToolContext, "signal"> | undefined;

    if (requestedModel !== undefined || needsToolContext) {
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

    // nginx 등 리버스 프록시가 SSE 를 버퍼링하지 않게(토큰 순차 전달 보장). Next origin
    //   압축은 next.config compress:false 로 이미 끔.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      // 장시간 툴(deep_research: researcher 병렬 ~30s + synthesis ~30s idle 갭)에
      //   프록시/undici 가 연결을 끊지 않도록 keep-alive comment 를 주기 방출한다.
      //   ": ..." 는 SSE 주석 — client parser(\n\n frame → parseSseFrame)는 무시한다.
      const heartbeat = setInterval(() => {
        void stream.write(": ping\n\n").catch(() => {});
      }, 10_000);
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
          maxTokens:
            deps.maxTokens ??
            resolvedSettings.maxTokens ??
            SAFE_DEFAULT_MAX_TOKENS,
          signal: handle.controller.signal,
          // org 가 admin 설정에서 DEFAULT_ORG_SETTINGS 값(0.7/0.9)을 바꾼 경우에만 forward —
          // 미조정 org 는 provider SDK 기본값을 그대로 유지한다(비파괴, P15-T2-01).
          ...(resolvedSettings.temperature !== undefined &&
          resolvedSettings.temperature !== DEFAULT_ORG_SETTINGS.temperature
            ? { temperature: resolvedSettings.temperature }
            : {}),
          ...(resolvedSettings.topP !== undefined &&
          resolvedSettings.topP !== DEFAULT_ORG_SETTINGS.topP
            ? { topP: resolvedSettings.topP }
            : {}),
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
      } catch (err) {
        // 예외로 stop 없이 스트림이 닫히면 client 가 "연결 끊김"으로 오인 → 명시적 error
        //   event 를 방출해 종단 처리(재시도 안내) 되게 한다.
        const message =
          err instanceof Error
            ? err.message
            : "턴 처리 중 오류가 발생했습니다.";
        await stream
          .writeSSE({
            event: "error",
            data: JSON.stringify({
              error: {
                code: "TURN_FAILED",
                category: "orchestrator",
                message,
                retryable: true,
              },
            }),
          })
          .catch(() => {});
        try {
          await activeRuns.setActiveRun(sessionId, jobId, "cancelled");
        } catch {
          /* best-effort */
        }
      } finally {
        clearInterval(heartbeat);
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

    c.header("X-Accel-Buffering", "no");
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

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
  type Message,
  type Organization,
  type PromptBlock,
  type ToolContext,
  type ToolMetricRepo,
} from "@wchat/interfaces";
import { runTurn } from "../orchestrator/orchestrator.js";
import {
  retrieveUserMemoryBlock,
  type UserMemoryReader,
} from "../orchestrator/memory-retriever.js";
import { generateFollowups } from "../orchestrator/followups.js";
import { generateSessionTitleAndTags } from "../orchestrator/session-title-tags.js";
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
import type { Citation } from "../knowledge/citation-helper.js";

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
  // P17-T1-05(TS-14) — 첨부 uploadId 들의 ephemeral_chunks 를 실제 hybridSearch 로 검색해
  // citation 으로 반환한다. 미주입 시(옵셔널) 기존 동작(파일명 안내만) 그대로 유지.
  // 청크 적재(업로드 시 parse+chunk+embed) 자체는 이 태스크 범위 밖 — 이미 적재된 청크를
  // "검색해 인용"하는 소비 측만 담당(db/ephemeral-chunk-search.ts).
  searchEphemeralChunks?(input: {
    sessionId: string;
    uploadIds: string[];
    queryText: string;
  }): Promise<Citation[]>;
}

const noopAttachments: AttachmentsPort = {
  async resolveEphemeralContext() {
    return null;
  },
};

// P17-T1-01 — 메시지 영속(TS-08). db/message-data-access.ts(createPgMessageDataAccess,
// MessageRepo 14-INTERFACES § 구현체)의 insert 만 소비 — turn 마다 user/assistant 메시지를
// messages 테이블에 저장한다. 미주입 시 no-op(기존 동작 보존).
export interface MessagesPort {
  insert(data: {
    sessionId: string;
    role: Message["role"];
    content: unknown;
    parentMessageId?: string | null;
    tokensIn?: number | null;
    tokensOut?: number | null;
  }): Promise<Message>;
  // P19-T2-03 — 응답 이어쓰기(continue)가 대상 메시지를 조회/갱신하는 데 쓴다. 둘 다
  // 옵셔널 — 미주입 환경(기존 테스트/배선)은 continue 라우트가 항상 404 로 fail-soft.
  byId?(id: string): Promise<Message | null>;
  update?(
    id: string,
    data: { content?: unknown; tokensOut?: number | null },
  ): Promise<Message>;
  // P19-T2-04 — 후속질문 제안이 마지막 턴(직전 user/assistant) 텍스트를 조회하는 데 쓴다.
  // 옵셔널 — 미주입 시 빈 컨텍스트로 orchestrator/followups.ts 의 파생 폴백만 반환(L2/L5).
  // app.ts 는 이미 createPgMessageDataAccess() 의 full MessageRepo(list 기 구현)를 주입 중이라
  // 구조적 타이핑으로 충족(app.ts 변경 불필요, P19-T2-03 byId/update 와 동일 패턴).
  list?(
    filter: { sessionId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: Message[]; nextCursor?: string }>;
}

// P19-T2-04 — 후속질문이 세션 메시지 내용을 읽어 응답에 반영하므로(deriveFollowups 는 마지막
// 턴 텍스트 일부를 그대로 응답에 splice), routes/sessions.ts GET /:id/messages 와 동일한
// ownership 검증(session.userId !== auth.sub → 404)이 반드시 필요하다 — 없으면 sessionId 를
// 아는 타 사용자/조직이 이 엔드포인트로 남의 대화 내용을 읽어낼 수 있다(cross-org 정보 노출).
export interface FollowupsSessionsPort {
  // P20-T1-03 — folderId 는 폴더 스코프 시스템 프롬프트 상속에도 재사용(optional 이라
  // 구조적 타이핑상 SessionWithPin(folderId: string | null, 필수)도 그대로 만족).
  byId(
    id: string,
  ): Promise<{ userId: string; folderId?: string | null } | null>;
  // P19-T2-06 — 첫 턴 완료 후 LLM 제목 반영에 재사용(구조적 타이핑 — app.ts 가 이미 주입 중인
  // createPgSessionDataAccess() 의 full SessionsDataAccess 가 updateForOwner 를 구현하므로
  // app.ts 변경 없이 충족). 옵셔널 — 미주입/미구현 시 제목 반영을 건너뛴다(L2 fail-soft).
  updateForOwner?(
    userId: string,
    id: string,
    data: { title?: string | null },
  ): Promise<unknown>;
}

// P19-T2-06 — 첫 턴 완료 후 생성한 태그를 session_tags(migration 0020)에 반영하는 포트.
// db/session-tag-data-access.ts SessionTagDataAccess 의 add 만 필요(구조적 타이핑).
export interface SessionTagsPort {
  add(orgId: string, sessionId: string, tag: string): Promise<unknown>;
}

// P20-T1-03 — 폴더 스코프 시스템 프롬프트 조회 포트(db/session-folder-data-access.ts
// SessionFolderDataAccess.byIdForOwner 와 구조적으로 호환 — SessionFolder 가 systemPrompt
// 를 포함하므로 app.ts 변경 없이 그대로 주입 가능).
export interface FolderSystemPromptPort {
  byIdForOwner(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<{ systemPrompt: string | null } | null>;
}

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
  // P19-T2-04 — followups ownership 검증 전용(FollowupsSessionsPort 참고).
  sessions?: FollowupsSessionsPort;
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
  ensureSession?: (
    sessionId: string,
    userId: string,
    firstContent?: string,
  ) => Promise<void>;
  hitl?: HitlBridge;
  logger?: Logger;
  // P11-T2-13 — 각 tool invoke 계측(tool-metrics 기록 + gen_ai.* span). 미주입 시 계측 생략.
  toolMetrics?: Pick<ToolMetricRepo, "append">;
  // P14-T2-01 — org-scoped admin 설정(maxTokens/systemPrompt/defaultModel) 조회. 미주입 시
  // DEFAULT_ORG_SETTINGS 로 fail-soft(기존 동작 보존 + 구 1024 폴백은 여전히 제거됨).
  settings?: SettingsResolverPort;
  // P17-T1-01 — 턴마다 user/assistant 메시지를 messages 테이블에 영속. 미주입 시 no-op.
  messages?: MessagesPort;
  // P19-T2-06 — 첫 턴 완료 후 session_tags 에 생성된 태그를 반영. 미주입 시 태그 반영 생략.
  tags?: SessionTagsPort;
  // P20-T1-03 — 폴더 스코프 시스템 프롬프트 상속(Open WebUI Folder System Prompt 참고).
  // 미주입 시 상속 생략(기존 동작 보존, L2).
  folders?: FolderSystemPromptPort;
  // P20-T1-09 — 영구 사용자 메모리 회상(저장→프롬프트 주입). db/user-memory-data-access.ts
  // (createPgUserMemoryDataAccess)의 UserMemoryReader 를 그대로 주입(구조적 타이핑). 미주입
  // 시 회상 생략(기존 동작 보존, L2).
  memories?: UserMemoryReader;
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
        webSearch?: boolean;
        mode?: "agent" | "chat";
        temporary?: boolean;
      }>()
      .catch(
        () =>
          ({}) as {
            content?: string;
            attachments?: Array<{ uploadId: string }>;
            model?: string;
            webSearch?: boolean;
            mode?: "agent" | "chat";
            temporary?: boolean;
          },
      );
    // P19-T2-05 — 임시 채팅: body.temporary=true 면 세션 upsert(ensureSession)와
    //   user/assistant 메시지 영속(messages.insert)을 모두 스킵한다(미영속, 스트림만 반환).
    const isTemporary = body.temporary === true;

    // 클라이언트 생성 세션 UUID 를 첫 메시지 시 DB 에 보장(upsert) — 이후 아티팩트/업로드/
    //   active-run 의 sessions FK 를 충족(없으면 deep_research 리포트 저장 등이 FK 위반).
    const auth = c.get("auth");
    if (auth && !isTemporary) {
      await deps.ensureSession?.(
        c.req.param("id"),
        auth.sub,
        body.content?.trim(),
      );
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

    // P20-T1-03 — 폴더 스코프 시스템 프롬프트 상속(Open WebUI Folder System Prompt 참고):
    // 세션이 속한 폴더에 system_prompt 가 설정돼 있으면 project-tier PromptBlock 로 반영한다
    // (tier 우선순위 system>project>user 유지 — buildSystemPrompt 가 최종 정렬).
    // 미인증/deps.sessions·deps.folders 미주입/폴더 미배정/미설정 시 조회를 건너뛴다
    // (L2 fail-soft, 기존 동작 보존).
    let folderSystemPrompt: string | null = null;
    if (auth && deps.sessions && deps.folders) {
      const session = await deps.sessions
        .byId(c.req.param("id"))
        .catch(() => null);
      const folderId = session?.folderId ?? null;
      if (folderId) {
        const folder = await deps.folders
          .byIdForOwner(auth.org, auth.sub, folderId)
          .catch(() => null);
        folderSystemPrompt = folder?.systemPrompt ?? null;
      }
    }
    const folderSystemBlock: PromptBlock[] = folderSystemPrompt
      ? [{ tier: "project", content: folderSystemPrompt }]
      : [];

    // P20-T1-09 — 영구 사용자 메모리 회상: routes/memories.ts 로 저장된 메모리(user_memories)를
    // 매 턴 system 프롬프트에 자동 주입한다(저장·조회 UI 는 이미 있었으나 런타임 소비가 0).
    // retrieveUserMemoryBlock(T2 소유, orchestrator/memory-retriever.ts)이 핀 우선+최근순 정렬 후
    // tier="user" PromptBlock 으로 변환 — auth.sub 로만 조회해 타 사용자 메모리가 섞이지 않는다
    // (user_memories 는 user_id 단위 격리라 org 컬럼 자체가 없음). 미인증/deps.memories 미주입 시
    // 조회를 건너뛴다(L2 fail-soft, 기존 동작 보존).
    let memoryBlock: PromptBlock[] = [];
    if (auth && deps.memories) {
      const block = await retrieveUserMemoryBlock(
        deps.memories,
        auth.sub,
      ).catch((error) => {
        deps.logger?.warn({
          category: "system",
          msg: "사용자 메모리 회상 실패",
          context: { error: String(error) },
        });
        return null;
      });
      memoryBlock = block ? [block] : [];
    }

    const systemBlocks = [
      ...orgSystemBlock,
      ...folderSystemBlock,
      ...memoryBlock,
      ...(deps.systemBlocks ?? []),
    ];
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

    // P17-T1-05(TS-14) — 첨부가 있으면 세션 ephemeral_chunks 를 실제 검색해 citation 으로
    // 반영한다. 미주입/미첨부 시 빈 배열(기존 동작 보존).
    const uploadIds = (body.attachments ?? []).map((a) => a.uploadId);
    const attachmentCitations: Citation[] =
      uploadIds.length > 0 && attachmentsPort.searchEphemeralChunks
        ? await attachmentsPort
            .searchEphemeralChunks({ sessionId, uploadIds, queryText: content })
            .catch((error) => {
              deps.logger?.warn({
                category: "system",
                msg: "ephemeral chunk 검색 실패",
                context: { error: String(error) },
              });
              return [];
            })
        : [];

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

    // P19-T2-01 — 웹검색 토글: admin org_settings.webSearchEnabled(허용 게이트) + 요청
    // body.webSearch(사용자 의도) 둘 다 true 일 때만 web_search 를 tool set 에 포함한다.
    // admin off 면 요청과 무관하게 강제 제외, settings 미조회(fail-soft) 시 DEFAULT
    // false 로 안전 기본(L2). 클라가 payload 로만 보내던 webSearch 를 여기서 처음 소비한다.
    const includeWebSearch =
      resolvedSettings.webSearchEnabled === true && body.webSearch === true;
    if (!includeWebSearch) {
      tools = tools.filter((t) => t.spec.name !== "web_search");
    }

    // P19-T2-02 — 모드(agent/chat) 실동작: mode='chat' 은 순수 대화로, 도구 없이(tools=[])
    // runTurn 을 호출한다. 'agent'(기본, 미지정 포함)는 기존 도구 배선을 그대로 유지한다.
    if (body.mode === "chat") {
      tools = [];
    }

    // P17-T1-01 — user 메시지를 messages 테이블에 영속(best-effort — 실패해도 turn 은 계속).
    // P19-T2-05 — temporary 턴은 영속 자체를 스킵한다.
    const userMessage = isTemporary
      ? undefined
      : await deps.messages
          ?.insert({ sessionId, role: "user", content })
          .catch((error) => {
            deps.logger?.warn({
              category: "system",
              msg: "user message 영속 실패",
              context: { error: String(error) },
            });
            return undefined;
          });

    // P19-T2-06 — 첫 턴(세션 최초 user 메시지) 여부: 방금 삽입한 이 user 메시지 하나뿐이면
    // 최초 턴이다(LLM 제목/태그 생성은 이때만 트리거). deps.messages.list 미주입/조회 실패
    // 시 실행하지 않는다(L2 fail-soft) — messages-followups-composition.test.ts 의
    // list?.() 옵셔널 재사용 패턴과 동일.
    const isFirstTurn =
      !isTemporary && userMessage !== undefined && deps.messages?.list
        ? await deps.messages
            .list({ sessionId }, { limit: 2 })
            .then((r) => r.items.length <= 1)
            .catch(() => false)
        : false;

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
      let assistantText = "";
      let assistantUsage:
        { inputTokens: number; outputTokens: number } | undefined;
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
            // P17-T1-05(TS-14) — 첨부 ephemeral 청크 검색 결과를 이 turn 의 citation 이벤트로
            // 방출(모델의 tool_use 여부와 무관하게 결정적으로 반영).
            for (const citation of attachmentCitations) {
              const citationEvent = { type: "citation" as const, ...citation };
              recordMessageRunEvent(currentMessageId, citationEvent);
              await stream.writeSSE({
                event: "citation",
                data: JSON.stringify(citation),
              });
            }
          } else if (currentMessageId) {
            recordMessageRunEvent(currentMessageId, event);
          }
          if (event.type === "text_delta") {
            assistantText += event.text;
          } else if (event.type === "stop") {
            assistantUsage = event.usage;
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
        // P17-T1-01 — assistant 메시지 영속(정상 종료·취소·에러 경로 모두 finally 에서 1회).
        // message_start 가 한 번도 없었으면(예: 초기 검증 실패) 빈 행을 남기지 않는다.
        // P19-T2-05 — temporary 턴은 영속 자체를 스킵한다.
        if (currentMessageId && !isTemporary) {
          await deps.messages
            ?.insert({
              sessionId,
              role: "assistant",
              content: assistantText,
              parentMessageId: userMessage?.id ?? null,
              tokensIn: assistantUsage?.inputTokens ?? null,
              tokensOut: assistantUsage?.outputTokens ?? null,
            })
            .catch((error) => {
              deps.logger?.warn({
                category: "system",
                msg: "assistant message 영속 실패",
                context: { error: String(error) },
              });
            });
        }
        // P19-T2-06 — 첫 턴 완료 후 세션 제목·태그를 LLM 으로 생성(provider 부재/파싱 실패 시
        // deriveSessionTitle 파생 폴백 — L5). 취소된 턴(사용자 Stop)은 건너뛴다.
        if (
          isFirstTurn &&
          currentMessageId &&
          auth &&
          !handle.controller.signal.aborted
        ) {
          await generateSessionTitleAndTags({
            provider: deps.provider,
            model,
            userText: content,
            assistantText,
            signal: handle.controller.signal,
            ...(resolvedSettings.maxTokens !== undefined
              ? { maxTokens: resolvedSettings.maxTokens }
              : {}),
          })
            .then(async ({ title, tags }) => {
              if (title) {
                await deps.sessions?.updateForOwner?.(auth.sub, sessionId, {
                  title,
                });
              }
              if (tags.length > 0 && deps.tags) {
                for (const tag of tags) {
                  await deps.tags.add(auth.org, sessionId, tag);
                }
              }
            })
            .catch((error) => {
              deps.logger?.warn({
                category: "system",
                msg: "세션 제목/태그 생성 실패",
                context: { error: String(error) },
              });
            });
        }
      }
    });
  });

  // P19-T2-03 — 응답 이어쓰기(continue): 직전 assistant 텍스트를 prefix 로 이어서, 기존
  // SSE 파이프(text_delta/stop, 신규 이벤트 금지)를 그대로 재사용해 스트리밍한다. 새로 emit
  // 하는 text_delta 는 이어지는 내용만(클라가 이미 표시 중인 prefix 를 중복 emit 하지
  // 않음) — 완료 시 원본 assistant 메시지 행(mid)을 prefix+새텍스트로 update 한다(새 행
  // 생성 아님). deps.messages.byId/update 미주입 시 404/no-op(L2 fail-soft).
  app.post("/:id/messages/:mid/continue", async (c) => {
    const sessionId = c.req.param("id");
    const messageId = c.req.param("mid");
    const auth = c.get("auth");

    if (!deps.messages?.byId) {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    const prior = await deps.messages.byId(messageId).catch(() => null);
    if (!prior || prior.sessionId !== sessionId) {
      return c.json(errorJson("NOT_FOUND", "메시지를 찾을 수 없습니다."), 404);
    }
    if (prior.role !== "assistant") {
      return c.json(
        errorJson("INVALID_INPUT", "assistant 메시지만 이어쓸 수 있습니다."),
        400,
      );
    }
    const priorText = typeof prior.content === "string" ? prior.content : "";

    const resolvedSettings = await resolveSettingsSafely(
      deps.settings,
      auth?.org,
      deps.logger,
    );

    const continueMessages: LLMMessage[] = [
      { role: "assistant", content: priorText },
      {
        role: "user",
        content: "이전 답변에 자연스럽게 이어서 계속 작성해줘.",
      },
    ];

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

    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const heartbeat = setInterval(() => {
        void stream.write(": ping\n\n").catch(() => {});
      }, 10_000);
      let currentMessageId: string | undefined;
      let continuedText = "";
      let assistantUsage:
        { inputTokens: number; outputTokens: number } | undefined;
      try {
        const events = runTurn({
          provider: deps.provider,
          model: deps.model,
          systemBlocks: deps.systemBlocks ?? [],
          messages: continueMessages,
          maxTokens:
            deps.maxTokens ??
            resolvedSettings.maxTokens ??
            SAFE_DEFAULT_MAX_TOKENS,
          signal: handle.controller.signal,
        });
        for await (const event of events) {
          if (event.type === "message_start") {
            currentMessageId = event.messageId;
            startMessageRun(event.messageId, sessionId);
          } else if (currentMessageId) {
            recordMessageRunEvent(currentMessageId, event);
          }
          if (event.type === "text_delta") {
            continuedText += event.text;
          } else if (event.type === "stop") {
            assistantUsage = event.usage;
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
        if (continuedText.length > 0) {
          await deps.messages
            ?.update?.(messageId, {
              content: priorText + continuedText,
              tokensOut: assistantUsage?.outputTokens ?? prior.tokensOut,
            })
            .catch((error) => {
              deps.logger?.warn({
                category: "system",
                msg: "continue 메시지 영속 실패",
                context: { error: String(error) },
              });
            });
        }
      }
    });
  });

  // P19-T2-04 — 후속질문 제안: 마지막 턴(직전 user/assistant) 텍스트를 orchestrator/
  // followups.ts 에 넘겨 LLM 에게 3개 질문을 요청한다. SSE 아님(frozen ChatEvent 확장 회피,
  // §1 REST 규칙) — 단일 JSON 응답. deps.messages.list 미주입/조회 실패 시 빈 컨텍스트로도
  // generateFollowups 가 항상 3개(파생 폴백)를 반환하므로 조용한 실패가 없다(L5).
  app.post("/:id/followups", async (c) => {
    const sessionId = c.req.param("id");
    const auth = c.get("auth");

    // routes/sessions.ts GET /:id/messages 와 동일한 ownership 검증 — deriveFollowups 가
    // 마지막 턴 텍스트 일부를 응답에 그대로 splice 하므로, 세션 소유자가 아니면 컨텍스트를
    // 읽지 않고 404 로 차단한다(existence-leak 방지, cross-org 정보 노출 방지).
    if (deps.sessions) {
      const session = await deps.sessions.byId(sessionId);
      if (!session || session.userId !== auth?.sub) {
        return c.json(errorJson("NOT_FOUND", "세션을 찾을 수 없습니다."), 404);
      }
    }

    let lastUserText = "";
    let lastAssistantText = "";
    if (deps.messages?.list) {
      const page = await deps.messages
        .list({ sessionId }, { limit: 100 })
        .catch((error) => {
          deps.logger?.warn({
            category: "system",
            msg: "followups 컨텍스트 조회 실패 — 빈 컨텍스트로 폴백",
            context: { error: String(error) },
          });
          return { items: [] as Message[] };
        });
      for (const m of page.items) {
        const text = typeof m.content === "string" ? m.content : "";
        if (m.role === "user") lastUserText = text;
        else if (m.role === "assistant") lastAssistantText = text;
      }
    }

    const followups = await generateFollowups({
      provider: deps.provider,
      model: deps.model,
      lastUserText,
      lastAssistantText,
      signal: c.req.raw.signal,
    });

    return c.json({
      data: { followups },
      meta: { requestId: randomUUID() },
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

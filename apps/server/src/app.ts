import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env.js";
import { createPgAuthDataAccess } from "./db/auth-data-access.js";
import { createEmailSender } from "./lib/email-sender.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createLdaptsDirectoryClient } from "./lib/ldap-client.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createFolderRoutes } from "./routes/folders.js";
import { createPgSessionFolderDataAccess } from "./db/session-folder-data-access.js";
import { createPromptRoutes } from "./routes/prompts.js";
import { createApiKeyRoutes } from "./routes/api-keys.js";
import { createMessageRoutes } from "./routes/messages.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createPgProjectDataAccess } from "./db/project-data-access.js";
import { createUploadRoutes } from "./routes/uploads.js";
import { createPgUploadDataAccess } from "./db/upload-data-access.js";
import { bulkInsertEphemeralChunks } from "./db/ephemeral-chunk-data-access.js";
import { createDocumentRoutes } from "./routes/documents.js";
import { createNotificationRoutes } from "./routes/notifications.js";
import { publishNotification } from "./orchestrator/notification-registry.js";
import { createPgDocumentDataAccess } from "./db/project-document-data-access.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createPgArtifactDataAccess } from "./db/artifact-data-access.js";
import { createPgMessageDataAccess } from "./db/message-data-access.js";
import { createPgSessionDataAccess } from "./db/session-data-access.js";
import { createPgSessionTagDataAccess } from "./db/session-tag-data-access.js";
import { pgPool } from "./db/client.js";
import { createArtifactShareRoutes } from "./routes/artifact-shares.js";
import { createPgArtifactShareDataAccess } from "./db/artifact-share-data-access.js";
import { createPublicShareRoutes } from "./routes/public-share.js";
import { createScimRoutes } from "./routes/scim.js";
import {
  createConversationShareRoutes,
  createPublicConversationShareRoutes,
} from "./routes/conversation-share.js";
import { createPgConversationShareDataAccess } from "./db/conversation-share-data-access.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createPgUserMemoryDataAccess } from "./db/user-memory-data-access.js";
import { createMcpServerRoutes } from "./routes/mcp-servers.js";
import { createPgMcpServerDataAccess } from "./db/mcp-server-data-access.js";
import { createOpenApiToolServerRoutes } from "./routes/openapi-tool-servers.js";
import { createPgOpenApiToolServerDataAccess } from "./db/openapi-tool-server-data-access.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createNoteRoutes } from "./routes/notes.js";
import {
  createConnectionRoutes,
  createDefaultProviderProbe,
} from "./routes/connections.js";
import { createPgProviderConnectionDataAccess } from "./db/provider-connection-data-access.js";
import { createKekProvider } from "./lib/kek-provider.js";
import { createConnectionProviderResolver } from "./orchestrator/connection-provider-resolver.js";
import { createOpenAILLMProvider } from "./orchestrator/llm-provider-openai.js";
import OpenAI from "openai";
import { createPgAgentDataAccess } from "./db/agent-data-access.js";
import { createPgUserSkillStore } from "./db/user-skill-data-access.js";
import { createPgNoteDataAccess } from "./db/note-data-access.js";
import { assembleOrgOpenApiTools } from "./tools/openapi-tool-assembler.js";
import { createOpenApiToolInvoker } from "./tools/openapi-tool-invoker.js";
import { createMcpClientPool } from "./mcp/mcp-client-pool.js";
import { createMcpBridge } from "./mcp/mcp-bridge.js";
import { createSkillRoutes } from "./routes/skills.js";
import { createSkillAssetRoutes } from "./routes/skill-assets.js";
import { createPgSkillAssetDataAccess } from "./db/skill-asset-data-access.js";
import { createQuotaRoutes } from "./routes/quota.js";
import { createPgQuotaDataAccess } from "./db/quota-data-access.js";
import { createUsageRoutes } from "./routes/usage.js";
import { createPgUsageLogDataAccess } from "./db/usage-log-data-access.js";
import { createErrorRoutes } from "./routes/errors.js";
import { createPgErrorLogDataAccess } from "./db/error-log-data-access.js";
import { createAdminRoutes } from "./routes/admin.js";
import { createAdminSettingsRoutes } from "./routes/admin-settings.js";
import { createCompletionRoutes } from "./routes/completions.js";
import { createAdminModelsRoutes } from "./routes/admin-models.js";
import { createAdminToolsRoutes } from "./routes/admin-tools.js";
import { createAdminGroupsRoutes } from "./routes/admin-groups.js";
import { createAdminGrantsRoutes } from "./routes/admin-grants.js";
import { createPgResourceGrantsDataAccess } from "./db/resource-grants-data-access.js";
import { createAdminAnalyticsRoutes } from "./routes/admin-analytics.js";
import { createPgAdminAnalyticsDataAccess } from "./db/admin-analytics-data-access.js";
import { createAdminAuditRoutes } from "./routes/admin-audit.js";
import { createPgAuditLogDataAccess } from "./db/audit-log-data-access.js";
import { createAuditRecorder } from "./lib/audit-recorder.js";
import { createConfigRoutes } from "./routes/config.js";
import { createPgHealthHistoryDataAccess } from "./db/health-history-data-access.js";
import { createPgAdminDataAccess } from "./db/admin-data-access.js";
import { createPgOrgSettingsDataAccess } from "./db/org-settings-data-access.js";
import { createSettingsService } from "./lib/settings-service.js";
import { createWebhookDispatcher } from "./lib/webhook-dispatcher.js";
import { deriveSessionTitle } from "./lib/session-title.js";
import { DEFAULT_ORG_SETTINGS } from "./lib/org-settings-schema.js";
import { createSkillRegistry } from "./tools/skills-engine.js";
import { assembleBuiltinTools } from "./tools/assemble-builtin-tools.js";
import { createDevStubImageGenProvider } from "./tools/image-gen-provider-dev-stub.js";
import { hitlBridge } from "./tools/hitl-manager.js";
import { createInlineArtifactStore } from "./lib/artifact-store.inline.js";
import { createS3ArtifactStore } from "./lib/artifact-store.s3.js";
import { createLocalObjectStore } from "./lib/object-store.js";
import { createParserPipeline } from "./knowledge/parser-pipeline.js";
import { withUsageTracking } from "./knowledge/embedding-provider.js";
import { createDevStubEmbeddingProvider } from "./knowledge/embedding-provider-dev-stub.js";
import { createKnowledgeRetrievalPgPort } from "./knowledge/knowledge-retrieval-pg.js";
import { selectRelevantTools } from "./tools/tool-router.js";
import { createPgAttachmentsPort } from "./db/ephemeral-chunk-search.js";
import {
  authMiddleware,
  type AuthedVariables,
} from "./middleware/auth-middleware.js";
import { createAnthropicLLMProvider } from "./orchestrator/llm-provider-anthropic.js";
import { createDevStubLLMProvider } from "./orchestrator/llm-provider-dev-stub.js";
import { createLLMProviderRegistry } from "./orchestrator/llm-provider-registry.js";
import { setActiveRun } from "./db/active-runs-service.js";
import { createLogger } from "./lib/logger.js";
import type { AgentTool } from "@wchat/interfaces";
import type { McpServerDataAccess } from "./db/mcp-server-data-access.js";

// P11-T2-02 — org 소유 MCP 서버가 discover 로 이미 등록해 둔 tool spec 을 실행 가능한
// AgentTool[] 로 조립한다(초대 후 org 경계 밖 서버 유출을 막기 위해 org 자신의
// mcp_servers 만 조회 — mcpBridge.listRegisteredTools() 자체는 전역 registry 라 서버
// 단위로 필터링). tool name 은 mcp-tool-adapter.ts 의 `mcp:{serverId}:{toolName}` 규칙.
function assembleOrgMcpTools(
  mcpServerDa: McpServerDataAccess,
  mcpBridge: ReturnType<typeof createMcpBridge>,
  mcpClientPool: ReturnType<typeof createMcpClientPool>,
) {
  return async (orgId: string): Promise<AgentTool[]> => {
    const page = await mcpServerDa.mcpServers.list({ orgId });
    const tools: AgentTool[] = [];
    for (const server of page.items) {
      for (const spec of mcpBridge.listRegisteredTools(server.id)) {
        const prefix = `mcp:${server.id}:`;
        const toolName = spec.name.startsWith(prefix)
          ? spec.name.slice(prefix.length)
          : spec.name;
        tools.push({
          spec,
          async invoke({ toolCallId, args, ctx }) {
            const result = await mcpClientPool.invoke(
              server.id,
              toolName,
              args,
              ctx.signal,
            );
            return { ...result, toolCallId };
          },
        });
      }
    }
    return tools;
  };
}

// P20-T2-04 — per-turn tool-routing top-k. 내장 도구(artifact_create/web_search/
// code_interpreter/deep_research/knowledge_search/search_chats/view_chat/add_memory/
// search_memories, 최대 9개)는 항상 topK 이하로 유지해 selectRelevantTools 가 임베딩
// 호출 없이 그대로 통과시킨다(tool-router.ts L33 단락 회피) — dev-stub 임베딩(토큰 중복
// 기반 근사, 실 Voyage 아님)의 낮은 의미 정밀도로 인해 소규모 내장 카탈로그에서 knowledge_search/
// search_chats/view_chat 같은 필수 도구가 오탐 배제되는 회귀를 막기 위함(P20-T1-02/T2-01
// 조립 통합테스트로 실측 확인됨). MCP 조립 결과(20-MULTI-AGENT-TOOL.md 가 말하는 200+ 카탈로그
// 시나리오)까지 합쳐 이 값을 넘을 때만 실제로 필터링이 작동한다.
const TOOL_ROUTER_TOP_K = 12;

export function createApp(env: Env) {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      deps: { db: "unknown", redis: "unknown", e2b: "unknown", llm: "unknown" },
      ts: new Date().toISOString(),
    }),
  );

  app.get("/api/v1/_ping", (c) =>
    c.json({
      data: { ok: true, env: env.NODE_ENV },
      meta: { requestId: crypto.randomUUID() },
    }),
  );

  const appOrigin = env.APP_ORIGIN ?? "http://localhost:3000";

  // P14-T2-01/P15-T1-01 — routes/messages.ts·routes/auth.ts 가 org-scoped 설정(maxTokens 등·
  // enableSignup/defaultUserRole)을 실제 요청에 반영하도록 admin-settings 라우트(§ 아래)와
  // 동일 인스턴스를 공유한다(per-org TTL 캐시가 admin PUT 이후 invalidate 와 일관되도록).
  const orgSettingsDa = createPgOrgSettingsDataAccess();
  const settingsService = createSettingsService({
    da: orgSettingsDa,
    logger: createLogger(),
  });

  const authDa = createPgAuthDataAccess();
  // P22-T1-11(C14) — LDAP/AD 디렉터리 클라이언트. org_settings.ldapEnabled 기본 false 라
  // 미설정 org 는 기존 매직링크/비밀번호 경로 그대로다(비파괴). ldapts 미설치 환경에서는
  // 실제 호출 시점에 LdapConnectionError 로 실패해 503 으로 표면화된다(createEmailSender 패턴).
  const directoryClient = createLdaptsDirectoryClient();
  app.route(
    "/api/v1/auth",
    createAuthRoutes({
      directoryClient,
      da: authDa,
      emailSender: createEmailSender(env.EMAIL_SENDER_KIND),
      allowedDomains: env.ALLOWED_DOMAINS.split(",").map((d) => d.trim()),
      appOrigin,
      secureCookies: env.NODE_ENV === "production",
      // dev/test 에서만 /api/v1/auth/dev-login 활성(production 은 404). SSO 도입 전 로컬 편의.
      devLogin: env.NODE_ENV !== "production",
      // enableSignup=false 인 org 는 허용 도메인이라도 가입 거부, 생성 유저 role 은
      // defaultUserRole 로 반영(P15-T1-01). 미조회/실패 시 DEFAULT_ORG_SETTINGS 로 fail-soft.
      settings: settingsService,
      // P20-T1-14 → P22-T1-06 — WEBHOOK_DISPATCHER_KIND env kind-switch. 미설정 시 record-only
      // dev-stub(LOCAL_ONLY, 실 네트워크 미발송), 배포 시 http/slack/discord 로 flip 하면 실 HTTP
      // dispatcher 발송(createEmailSender/createAlertNotifier 와 동일 패턴).
      webhookDispatcher: createWebhookDispatcher(),
    }),
  );

  // ANTHROPIC_API_KEY 미설정(dev/CI) 시 실 네트워크 호출 없는 dev-stub 으로 fail-soft.
  // P11-T2-03 — 레지스트리 뒤에서 조립: 오늘은 concrete provider 가 하나뿐이지만, 이후
  // provider 가 추가돼도 routes/messages.ts·runTurn 은 registry 하나만 알면 된다.
  const concreteProvider = env.ANTHROPIC_API_KEY
    ? createAnthropicLLMProvider({
        client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      })
    : createDevStubLLMProvider();
  // fallback=concreteProvider: 현재는 provider 가 하나뿐이라 provider.models 밖의 model
  // (org.allowedModels 로 동적 허용된 값 포함)도 그대로 위임 — 기존 동작 보존.
  const provider = createLLMProviderRegistry({
    providers: [concreteProvider],
    fallback: concreteProvider,
  });

  // P11-T2-02 — routes/messages.ts 가 tools+toolContext 를 조립하는 데 필요한 built-in
  // handler(artifact_create) + MCP 조립 함수. mcp-servers 라우트(§ 아래)와 인스턴스를
  // 공유해 discover 로 채워진 mcpBridge registry 를 그대로 재사용한다.
  const artifactDa = createPgArtifactDataAccess();
  // P20-T1-11 — documents/prompts/mcp-servers 조회 라우트가 공유하는 resource_grants(0027)
  // enforcement 포트. admin-grants 라우트(관리)와 동일 테이블, 별도 인스턴스로 조회 전용 사용.
  const resourceGrantsDa = createPgResourceGrantsDataAccess();
  const mcpServerDa = createPgMcpServerDataAccess();
  // P22-T1-12 — 등록 라우트(아래 openApiToolServersApp)와 채팅 턴 조립이 같은 DA 싱글톤을 공유.
  const openApiToolServerDa = createPgOpenApiToolServerDataAccess();
  // P22-T6-10 — 커스텀 워크스페이스 에이전트 레지스트리(0034_agents).
  const agentDa = createPgAgentDataAccess();
  // P22-T6-17 — 노트 워크스페이스(0037_notes).
  const noteDa = createPgNoteDataAccess();
  // P22-T6-14 — 외부 OpenAI 호환 provider 연결(0035_provider_connections).
  // 키는 KEK(계약 승인 C6: pluggable, 지금은 로컬 대칭키. 배포 시 KMS 구현으로 교체)로 봉인해
  // 저장하고 재조회 시 keyPrefix 만 노출한다(api_keys 마스킹 미러).
  const providerConnectionDa = createPgProviderConnectionDataAccess({
    kek: createKekProvider(env),
  });
  const mcpClientPool = createMcpClientPool({
    da: mcpServerDa,
    nodeEnv: env.NODE_ENV,
  });
  const mcpBridge = createMcpBridge({ pool: mcpClientPool });

  // P17-T1-02 — createSessionRoutes(GET /, GET /:id/messages)와 createMessageRoutes(메시지
  // 영속, P17-T1-01)가 같은 messages 테이블 데이터 접근 인스턴스를 공유.
  const messageDa = createPgMessageDataAccess();
  // P19-T2-04 — followups ownership 검증(session.userId !== auth.sub)에도 재사용.
  const sessionDa = createPgSessionDataAccess();
  // P19-T2-06 — 첫 턴 완료 후 생성된 세션 태그를 session_tags(0020)에 반영.
  const sessionTagDa = createPgSessionTagDataAccess();
  // P20-T1-09 — messages 라우트(런타임 회상)와 memoriesApp(CRUD, 기존 P7-T2-03)가 같은
  // user_memories 데이터 접근 인스턴스를 공유.
  const userMemoryDa = createPgUserMemoryDataAccess();

  const sessionsApp = new Hono<{ Variables: AuthedVariables }>();
  sessionsApp.use("*", authMiddleware);
  sessionsApp.route(
    "/",
    createSessionRoutes({
      sessions: sessionDa,
      sessionMessages: messageDa,
    }),
  );
  sessionsApp.route(
    "/",
    createMessageRoutes({
      provider,
      // P22-T6-14 — org 가 등록한 연결이 요청 모델을 제공하면 그 연결의 baseURL/키로 턴을
      // 보낸다. 연결 미등록 org 는 resolver 가 null 을 주므로 위 env provider 그대로(비파괴).
      resolveConnectionProvider: createConnectionProviderResolver({
        da: providerConnectionDa,
        createProvider: ({ baseUrl, apiKey, models }) =>
          createOpenAILLMProvider({
            client: new OpenAI({ baseURL: baseUrl, apiKey }),
            models,
          }),
      }),
      // 실 Anthropic 은 env.LLM_MODEL(기본 Haiku 4.5) 사용. dev-stub 은 모델명 무시(에코).
      // org_settings.defaultModel 이 설정돼 있으면(및 인증된 요청) messages.ts 가 이 값을
      // 대체한다 — settings resolve 실패/미설정 시 이 값 그대로 fail-soft.
      model: env.LLM_MODEL,
      activeRuns: { setActiveRun },
      sessions: sessionDa,
      tags: sessionTagDa,
      organizations: authDa.organizations,
      settings: settingsService,
      // 클라이언트 생성 세션 UUID(/chat/<uuid>)를 첫 메시지 시 upsert — 아티팩트/업로드/
      //   active-run 의 sessions FK 충족(deep_research 리포트 저장 FK 위반 해소). best-effort:
      //   잘못된 id 형식 등은 무시(RLS 는 pgPool 롤이 bypass, FK 만 필요).
      ensureSession: async (id, userId, firstContent) => {
        try {
          // 첫 메시지에서 세션 제목 파생 — ON CONFLICT DO NOTHING 이라 최초 생성 시 1회만 설정,
          //   이후 메시지는 기존 제목 보존. 제목 없으면 히스토리가 "(제목 없음)" 으로만 보임.
          const title = deriveSessionTitle(firstContent);
          await pgPool.query(
            `INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
            [id, userId, title],
          );
        } catch {
          /* best-effort — 세션 보장 실패해도 메시지 흐름은 계속 */
        }
      },
      // 내장 도구 전체 배선: artifact_create + web_search + code_interpreter + deep_research.
      //   키(TAVILY/E2B) 없으면 dev-stub 폴백(assemble-builtin-tools.ts).
      // assembleBuiltinTools 는 app 조립 시점(요청 전, org 미지정)에 한 번만 실행되는 싱글톤이라
      // tools 배열 자체(정적 maxTokens 등)는 org-scoped 로 재구성하지 않는다. 대신 deep_research
      // 는 settings resolver 를 deps 로 주입받아 invoke 시점에 ctx.orgId 로 동적 조회한다
      // (P15-T2-02, T3-01 의 invoke-time resolve 와 동일 패턴). 여기서는 정적 폴백값(settings
      // 미조회/미설정 시)으로 DEFAULT_ORG_SETTINGS.toolMaxTokens 단일 출처만 참조.
      tools: assembleBuiltinTools({
        provider,
        model: env.LLM_MODEL,
        // `?? 4096` — messages.ts SAFE_DEFAULT_MAX_TOKENS 와 동일한 TS `| undefined` 잔여 보강.
        maxTokens: DEFAULT_ORG_SETTINGS.toolMaxTokens ?? 4096,
        artifactDa,
        objectStore: createLocalObjectStore(),
        ...(env.TAVILY_API_KEY ? { tavilyApiKey: env.TAVILY_API_KEY } : {}),
        ...(env.E2B_API_KEY ? { e2bApiKey: env.E2B_API_KEY } : {}),
        settings: settingsService,
        // P20-T1-02 — knowledge_search 실배선: retrieval(T3 pg 포트, project_documents 스코프)
        // + embeddingProvider(dev-stub) 둘 다 주입해야 조립된다(assemble-builtin-tools.ts L1
        // last-mile 가드). 미주입 시 이전처럼 모델이 지식베이스를 아예 못 봤다(실사용 무동작).
        embeddingProvider: withUsageTracking(createDevStubEmbeddingProvider()),
        retrieval: createKnowledgeRetrievalPgPort(),
        // P20-T2-01 — search_chats/view_chat: 기존 sessionDa/messageDa 싱글톤을 그대로
        // 재주입(구조적 타이핑으로 SessionsSearchPort/ViewChatMessagesPort 충족, 신규 DA 불필요).
        sessions: sessionDa,
        sessionMessages: messageDa,
        // P22-T1-08 — image_generate: 전역 feature 게이트(env)가 켜지면 dev-stub provider 로
        // 조립(실 provider 는 배포 시 교체). org 별 on/off 는 settings resolver 로 invoke 시점 재확인.
        imageGenEnabled: env.IMAGE_GEN_ENABLED,
        imageGenPort: createDevStubImageGenProvider(),
        // P20-T1-10 — add_memory/search_memories: memoriesApp(CRUD)/P20-T1-09(런타임 회상)와
        // 같은 userMemoryDa 싱글톤을 재주입(신규 DA 불필요, 구조적 타이핑으로 MemoryToolsPort 충족).
        memories: userMemoryDa,
      }),
      mcpTools: assembleOrgMcpTools(mcpServerDa, mcpBridge, mcpClientPool),
      // P22-T1-12 — 등록된 OpenAPI 툴서버 endpoint 를 턴에 노출. 호출 직전 base URL 을 다시
      // SSRF 검증하는 invoker 를 주입(등록시 검증만으로는 DNS rebinding 을 막지 못함).
      openApiTools: assembleOrgOpenApiTools({
        da: openApiToolServerDa,
        invoke: createOpenApiToolInvoker({ nodeEnv: env.NODE_ENV }),
      }),
      hitl: hitlBridge,
      logger: createLogger(),
      // P17-T1-01 — 턴마다 user/assistant 메시지를 messages 테이블에 영속.
      messages: messageDa,
      // P17-T1-05(TS-14) — 첨부 uploadId 의 ephemeral_chunks 를 실제 검색해 citation 반영
      // (dev-stub embedding — 실 Voyage 는 배포 시 교체, CLAUDE.md LOCAL_ONLY 방침).
      attachments: createPgAttachmentsPort({
        embeddingProvider: createDevStubEmbeddingProvider(),
      }),
      // P20-T1-03 — 폴더 스코프 시스템 프롬프트 상속(routes/folders.ts 와 동일 pg 구현 재사용,
      // 구조적 타이핑상 FolderSystemPromptPort 를 그대로 만족).
      folders: createPgSessionFolderDataAccess(),
      // P20-T1-09 — 영구 사용자 메모리 런타임 회상(저장→프롬프트 주입).
      memories: userMemoryDa,
      // P20-T2-04 — per-turn 관련 도구만 노출: 조립된 tools(내장+MCP) 중 query 와
      // 관련도 높은 top-k 만 runTurn 에 전달(tools/tool-router.ts, dev-stub embedding —
      // 실 Voyage 는 배포 시 교체). 선택 결과가 비면 messages.ts 가 전체 tools 로 폴백한다.
      toolRouter: {
        select: (input) =>
          selectRelevantTools({
            tools: input.tools,
            query: input.query,
            topK: TOOL_ROUTER_TOP_K,
            embeddingProvider: createDevStubEmbeddingProvider(),
          }),
      },
    }),
  );
  // P20-T1-08 — 대화 스냅샷 공유(불변) 발급/revoke. sessionDa/messageDa 싱글톤 재사용
  // (구조적 타이핑으로 ConversationShareSessionsPort/MessagesPort 충족, 신규 DA 불필요).
  const conversationShareDa = createPgConversationShareDataAccess();
  sessionsApp.route(
    "/",
    createConversationShareRoutes({
      da: conversationShareDa,
      sessions: sessionDa,
      messages: messageDa,
      appOrigin,
    }),
  );
  app.route("/api/v1/sessions", sessionsApp);

  // 인증 우회 mount(P20-T1-08) — 대화 스냅샷 공개 조회. artifact 공개 조회(/api/v1/share)와
  // 별도 prefix 로 "미마운트 404" vs "유효하지 않은 토큰 404" 모호성을 없앤다
  // (routes/conversation-share.ts 상단 주석 참고).
  app.route(
    "/api/v1/conversation-shares",
    createPublicConversationShareRoutes({ da: conversationShareDa }),
  );

  // P19-T1-03 — 세션 폴더 CRUD(migration 0019 session_folders).
  const foldersApp = new Hono<{ Variables: AuthedVariables }>();
  foldersApp.use("*", authMiddleware);
  foldersApp.route("/", createFolderRoutes());
  app.route("/api/v1/folders", foldersApp);

  // P19-T1-08 — 프롬프트 라이브러리 CRUD(migration 0024 prompts).
  const promptsApp = new Hono<{ Variables: AuthedVariables }>();
  promptsApp.use("*", authMiddleware);
  promptsApp.route("/", createPromptRoutes({ grants: resourceGrantsDa }));
  app.route("/api/v1/prompts", promptsApp);

  const projectsApp = new Hono<{ Variables: AuthedVariables }>();
  projectsApp.use("*", authMiddleware);
  projectsApp.route("/", createProjectRoutes(createPgProjectDataAccess()));
  app.route("/api/v1/projects", projectsApp);

  const uploadsApp = new Hono<{ Variables: AuthedVariables }>();
  uploadsApp.use("*", authMiddleware);
  uploadsApp.route(
    "/",
    createUploadRoutes({
      da: createPgUploadDataAccess(),
      objectStore: createLocalObjectStore(),
      // P20-T1-01 — 업로드 시 ephemeral_chunks 실배선(첨부 RAG 인덱싱 생산측).
      // 실패해도 업로드는 성공(fail-soft, upload-service.ts 내부에서 try/catch).
      indexing: {
        parserPipeline: createParserPipeline(),
        embeddingProvider: withUsageTracking(createDevStubEmbeddingProvider()),
        bulkInsert: bulkInsertEphemeralChunks,
        logger: createLogger(),
      },
      // P20-T1-17 — 확장자 화이트리스트 + size/count enforcement.
      settings: settingsService,
    }),
  );
  app.route("/api/v1/uploads", uploadsApp);

  const documentsApp = new Hono<{ Variables: AuthedVariables }>();
  documentsApp.use("*", authMiddleware);
  documentsApp.route(
    "/",
    createDocumentRoutes({
      da: createPgDocumentDataAccess(),
      objectStore: createLocalObjectStore(),
      parserPipeline: createParserPipeline(),
      embeddingProvider: withUsageTracking(createDevStubEmbeddingProvider()),
      grants: resourceGrantsDa,
      // P22-T3-04 — index 시점 org-scoped 청크 설정(ragChunkSizeTokens/Overlap) 반영.
      settings: settingsService,
      // 인덱싱 완료(dev-stub 은 동기) 후 소유 사용자에게 document_indexed push (P22-T2-02).
      notify: publishNotification,
    }),
  );
  app.route("/api/v1/documents", documentsApp);

  // P22-T3-02 — 계약(16-API §666-710) nested 경로 /projects/:id/documents* 로도 서빙.
  // projectId 를 경로파라미터(:id)에서 읽는다(문서 id 는 :docId). flat /api/v1/documents 는
  // web 클라이언트(useDocuments) back-compat 를 위해 유지(둘 다 마운트).
  const nestedDocumentsApp = new Hono<{ Variables: AuthedVariables }>();
  nestedDocumentsApp.use("*", authMiddleware);
  nestedDocumentsApp.route(
    "/",
    createDocumentRoutes(
      {
        da: createPgDocumentDataAccess(),
        objectStore: createLocalObjectStore(),
        parserPipeline: createParserPipeline(),
        embeddingProvider: withUsageTracking(createDevStubEmbeddingProvider()),
        grants: resourceGrantsDa,
        // P22-T3-04 — nested 경로도 동일하게 org-scoped 청크 설정 반영.
        settings: settingsService,
        notify: publishNotification,
      },
      { nested: true },
    ),
  );
  app.route("/api/v1/projects/:id/documents", nestedDocumentsApp);

  // P22-T2-02 — GET /notifications SSE 사용자 단위 push 채널(계약 § 906).
  const notificationsApp = new Hono<{ Variables: AuthedVariables }>();
  notificationsApp.use("*", authMiddleware);
  notificationsApp.route("/", createNotificationRoutes());
  app.route("/api/v1/notifications", notificationsApp);

  // P22-T6-16 — POST /completions 입력 자동완성(ghost text). 컴포저가 debounce 호출한다.
  // org_settings.autocompleteEnabled 게이트는 라우트가 요청 시점에 settingsService 로 확인.
  const completionsApp = new Hono<{ Variables: AuthedVariables }>();
  completionsApp.use("*", authMiddleware);
  completionsApp.route(
    "/",
    createCompletionRoutes({
      provider,
      // 턴 생성과 같은 모델을 쓰되 maxTokens 를 작게 잡아 "빠른 task 모델" 처럼 동작시킨다.
      model: env.LLM_MODEL,
      settings: settingsService,
    }),
  );
  app.route("/api/v1/completions", completionsApp);

  const artifactsApp = new Hono<{ Variables: AuthedVariables }>();
  artifactsApp.use("*", authMiddleware);
  const artifactShareDa = createPgArtifactShareDataAccess();
  const artifactAndShareDa = { ...artifactDa, ...artifactShareDa };
  const inlineArtifactStore = createInlineArtifactStore(artifactDa.artifacts);
  const s3ArtifactStore = createS3ArtifactStore(createLocalObjectStore());
  artifactsApp.route(
    "/",
    createArtifactRoutes({
      da: artifactDa,
      inlineStore: inlineArtifactStore,
      s3Store: s3ArtifactStore,
      downloadSecret: env.JWT_SECRET,
    }),
  );
  artifactsApp.route(
    "/",
    createArtifactShareRoutes({
      da: artifactAndShareDa,
      appOrigin,
    }),
  );
  app.route("/api/v1/artifacts", artifactsApp);

  // 인증 우회 mount (16-API-CONTRACT § 8 GET /api/v1/share/:token(/content)) — authMiddleware 밖.
  app.route(
    "/api/v1/share",
    createPublicShareRoutes({
      da: artifactAndShareDa,
      inlineStore: inlineArtifactStore,
      s3Store: s3ArtifactStore,
    }),
  );

  // P22-T1-16(C15) — SCIM 2.0 프로비저닝. IdP 가 서버-대-서버로 호출하므로 사용자 JWT
  // (authMiddleware) 밖에 마운트하고, 라우트가 전용 Bearer 토큰(scim_tokens, 0040)으로
  // 인증하며 org 를 토큰에서만 파생한다(public-share 와 같은 인증-우회 mount 형태).
  app.route("/scim/v2", createScimRoutes());

  const memoriesApp = new Hono<{ Variables: AuthedVariables }>();
  memoriesApp.use("*", authMiddleware);
  memoriesApp.route("/", createMemoryRoutes({ da: userMemoryDa }));
  app.route("/api/v1/memories", memoriesApp);

  const mcpServersApp = new Hono<{ Variables: AuthedVariables }>();
  mcpServersApp.use("*", authMiddleware);
  mcpServersApp.route(
    "/",
    createMcpServerRoutes({
      da: mcpServerDa,
      nodeEnv: env.NODE_ENV,
      discover: (server) => mcpBridge.discoverServerTools(server),
      grants: resourceGrantsDa,
    }),
  );
  app.route("/api/v1/mcp-servers", mcpServersApp);

  // P22-T1-12 — OpenAPI 툴서버 인제스션. mcp-servers 와 같은 조립 패턴(auth → 라우트 →
  // resource_grants 필터). spec/base URL SSRF 검증은 라우트가 mcp/url-validator 로 수행하므로
  // 여기서는 nodeEnv 만 전달한다(mcp-servers 와 동일).
  const openApiToolServersApp = new Hono<{ Variables: AuthedVariables }>();
  openApiToolServersApp.use("*", authMiddleware);
  openApiToolServersApp.route(
    "/",
    createOpenApiToolServerRoutes({
      da: openApiToolServerDa,
      nodeEnv: env.NODE_ENV,
      grants: resourceGrantsDa,
    }),
  );
  app.route("/api/v1/openapi-tool-servers", openApiToolServersApp);

  // P22-T6-10 — 에이전트 레지스트리(Open WebUI Workspace>Models 파리티).
  // org 경계 + visibility(private=작성자만) 강제는 라우트가 수행(RLS superuser 우회 대비).
  const agentsApp = new Hono<{ Variables: AuthedVariables }>();
  agentsApp.use("*", authMiddleware);
  agentsApp.route("/", createAgentRoutes({ da: agentDa }));
  app.route("/api/v1/agents", agentsApp);

  // P22-T6-17 — 노트 워크스페이스(Open WebUI Notes 파리티). 노트는 작성자 전용이라
  // org 경계 + 소유자 경계 모두 라우트가 강제한다(RLS superuser 우회 대비, 남의 것은 404).
  // /:id/enhance 는 completions 와 같은 provider/model 을 쓰되 maxTokens 를 크게 잡는다
  // (자동완성은 조각, 노트 개선은 문서 전체를 다시 쓴다).
  const notesApp = new Hono<{ Variables: AuthedVariables }>();
  notesApp.use("*", authMiddleware);
  notesApp.route(
    "/",
    createNoteRoutes({ da: noteDa, provider, model: env.LLM_MODEL }),
  );
  app.route("/api/v1/notes", notesApp);

  // P22-T6-14 — Connections(Open WebUI Connections 파리티). org 경계는 라우트가 강제하고
  // baseUrl 은 등록/verify 양쪽에서 mcp/url-validator 로 SSRF 재검증한다(mcp-servers 미러).
  const connectionsApp = new Hono<{ Variables: AuthedVariables }>();
  connectionsApp.use("*", authMiddleware);
  connectionsApp.route(
    "/",
    createConnectionRoutes({
      da: providerConnectionDa,
      probe: createDefaultProviderProbe(),
      urlValidatorOptions: { nodeEnv: env.NODE_ENV },
    }),
  );
  app.route("/api/v1/connections", connectionsApp);

  // repo root/skills — skills/ 는 어떤 패키지도 import 불가(05-REPO-STRUCTURE.md), server 만
  // fs 로 직접 읽는다(skills-engine.ts 와 동일 경로 규칙).
  const skillsDir = fileURLToPath(new URL("../../../skills", import.meta.url));
  const skillsApp = new Hono<{ Variables: AuthedVariables }>();
  skillsApp.use("*", authMiddleware);
  skillsApp.route(
    "/",
    createSkillRoutes({
      registry: createSkillRegistry({ skillsDir }),
      skillsDir,
      // 사용자 작성 스킬(P22-T6-18 / 계약 C12) — 파일시스템 빌트인은 불변으로 두고
      // 작성·활성화·삭제는 user_skills 테이블(0038)에서만 일어난다.
      userSkills: createPgUserSkillStore(),
    }),
  );
  app.route("/api/v1/skills", skillsApp);

  const skillAssetsApp = new Hono<{ Variables: AuthedVariables }>();
  skillAssetsApp.use("*", authMiddleware);
  skillAssetsApp.route(
    "/",
    createSkillAssetRoutes({
      da: createPgSkillAssetDataAccess(),
      objectStore: createLocalObjectStore(),
    }),
  );
  app.route("/api/v1/skill-assets", skillAssetsApp);

  const quotaApp = new Hono<{ Variables: AuthedVariables }>();
  quotaApp.use("*", authMiddleware);
  quotaApp.route("/", createQuotaRoutes({ da: createPgQuotaDataAccess() }));
  app.route("/api/v1/quota", quotaApp);

  const usageApp = new Hono<{ Variables: AuthedVariables }>();
  usageApp.use("*", authMiddleware);
  usageApp.route("/", createUsageRoutes({ da: createPgUsageLogDataAccess() }));
  app.route("/api/v1/usage", usageApp);

  const errorsApp = new Hono<{ Variables: AuthedVariables }>();
  errorsApp.use("*", authMiddleware);
  errorsApp.route("/", createErrorRoutes({ da: createPgErrorLogDataAccess() }));
  app.route("/api/v1/errors", errorsApp);

  const auditLogDa = createPgAuditLogDataAccess();
  const auditRecorder = createAuditRecorder(auditLogDa, createLogger());

  const adminApp = new Hono<{ Variables: AuthedVariables }>();
  adminApp.use("*", authMiddleware);
  adminApp.route(
    "/",
    createAdminRoutes({
      da: createPgHealthHistoryDataAccess(),
      adminDa: createPgAdminDataAccess(),
      audit: auditRecorder,
    }),
  );
  adminApp.route(
    "/settings",
    createAdminSettingsRoutes({
      da: orgSettingsDa,
      settingsService,
      audit: auditRecorder,
      // P22-T1-11(C14) — POST /admin/settings/ldap/test 연결 확인용(같은 클라이언트 공유).
      directoryClient,
    }),
  );
  adminApp.route(
    "/models",
    createAdminModelsRoutes({
      organizations: authDa.organizations,
      audit: auditRecorder,
    }),
  );
  adminApp.route(
    "/tools",
    createAdminToolsRoutes({
      organizations: authDa.organizations,
      audit: auditRecorder,
    }),
  );
  adminApp.route("/groups", createAdminGroupsRoutes());
  adminApp.route(
    "/grants",
    createAdminGrantsRoutes({ grants: resourceGrantsDa, audit: auditRecorder }),
  );
  adminApp.route(
    "/analytics",
    createAdminAnalyticsRoutes({
      analyticsDa: createPgAdminAnalyticsDataAccess(),
    }),
  );
  adminApp.route("/audit-logs", createAdminAuditRoutes({ da: auditLogDa }));
  app.route("/api/v1/admin", adminApp);

  const configApp = new Hono<{ Variables: AuthedVariables }>();
  configApp.use("*", authMiddleware);
  configApp.route(
    "/",
    createConfigRoutes({
      organizations: authDa.organizations,
      models: provider.models,
      settings: settingsService,
    }),
  );
  app.route("/api/v1/config", configApp);

  // P19-T1-11 — API 키 발급/목록/폐기(self-service, migration 0025 api_keys).
  // P20-T1-12 — settingsService 공유로 enableApiKeys 마스터 토글을 발급 시점에 반영.
  const apiKeysApp = new Hono<{ Variables: AuthedVariables }>();
  apiKeysApp.use("*", authMiddleware);
  apiKeysApp.route("/", createApiKeyRoutes({ settings: settingsService }));
  app.route("/api/v1/api-keys", apiKeysApp);

  return app;
}

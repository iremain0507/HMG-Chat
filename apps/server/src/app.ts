import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env.js";
import { createPgAuthDataAccess } from "./db/auth-data-access.js";
import { createEmailSender } from "./lib/email-sender.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createSessionRoutes } from "./routes/sessions.js";
import { createMessageRoutes } from "./routes/messages.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createPgProjectDataAccess } from "./db/project-data-access.js";
import { createUploadRoutes } from "./routes/uploads.js";
import { createPgUploadDataAccess } from "./db/upload-data-access.js";
import { createDocumentRoutes } from "./routes/documents.js";
import { createPgDocumentDataAccess } from "./db/project-document-data-access.js";
import { createArtifactRoutes } from "./routes/artifacts.js";
import { createPgArtifactDataAccess } from "./db/artifact-data-access.js";
import { createArtifactShareRoutes } from "./routes/artifact-shares.js";
import { createPgArtifactShareDataAccess } from "./db/artifact-share-data-access.js";
import { createPublicShareRoutes } from "./routes/public-share.js";
import { createMemoryRoutes } from "./routes/memories.js";
import { createPgUserMemoryDataAccess } from "./db/user-memory-data-access.js";
import { createMcpServerRoutes } from "./routes/mcp-servers.js";
import { createPgMcpServerDataAccess } from "./db/mcp-server-data-access.js";
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
import { createConfigRoutes } from "./routes/config.js";
import { createPgHealthHistoryDataAccess } from "./db/health-history-data-access.js";
import { createPgAdminDataAccess } from "./db/admin-data-access.js";
import { createSkillRegistry } from "./tools/skills-engine.js";
import { createArtifactCreateTool } from "./tools/handlers/artifact-create-handler.js";
import { hitlBridge } from "./tools/hitl-manager.js";
import { createInlineArtifactStore } from "./lib/artifact-store.inline.js";
import { createS3ArtifactStore } from "./lib/artifact-store.s3.js";
import { createLocalObjectStore } from "./lib/object-store.js";
import { createParserPipeline } from "./knowledge/parser-pipeline.js";
import { withUsageTracking } from "./knowledge/embedding-provider.js";
import { createDevStubEmbeddingProvider } from "./knowledge/embedding-provider-dev-stub.js";
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

  const authDa = createPgAuthDataAccess();
  app.route(
    "/api/v1/auth",
    createAuthRoutes({
      da: authDa,
      emailSender: createEmailSender(env.EMAIL_SENDER_KIND),
      allowedDomains: env.ALLOWED_DOMAINS.split(",").map((d) => d.trim()),
      appOrigin,
      secureCookies: env.NODE_ENV === "production",
      // dev/test 에서만 /api/v1/auth/dev-login 활성(production 은 404). SSO 도입 전 로컬 편의.
      devLogin: env.NODE_ENV !== "production",
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
  const mcpServerDa = createPgMcpServerDataAccess();
  const mcpClientPool = createMcpClientPool({
    da: mcpServerDa,
    nodeEnv: env.NODE_ENV,
  });
  const mcpBridge = createMcpBridge({ pool: mcpClientPool });

  const sessionsApp = new Hono<{ Variables: AuthedVariables }>();
  sessionsApp.use("*", authMiddleware);
  sessionsApp.route("/", createSessionRoutes());
  sessionsApp.route(
    "/",
    createMessageRoutes({
      provider,
      // 실 Anthropic 은 env.LLM_MODEL(기본 Haiku 4.5) 사용. dev-stub 은 모델명 무시(에코).
      model: env.LLM_MODEL,
      activeRuns: { setActiveRun },
      organizations: authDa.organizations,
      tools: [createArtifactCreateTool({ da: artifactDa })],
      mcpTools: assembleOrgMcpTools(mcpServerDa, mcpBridge, mcpClientPool),
      hitl: hitlBridge,
      logger: createLogger(),
    }),
  );
  app.route("/api/v1/sessions", sessionsApp);

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
    }),
  );
  app.route("/api/v1/documents", documentsApp);

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

  const memoriesApp = new Hono<{ Variables: AuthedVariables }>();
  memoriesApp.use("*", authMiddleware);
  memoriesApp.route(
    "/",
    createMemoryRoutes({ da: createPgUserMemoryDataAccess() }),
  );
  app.route("/api/v1/memories", memoriesApp);

  const mcpServersApp = new Hono<{ Variables: AuthedVariables }>();
  mcpServersApp.use("*", authMiddleware);
  mcpServersApp.route(
    "/",
    createMcpServerRoutes({
      da: mcpServerDa,
      nodeEnv: env.NODE_ENV,
      discover: (server) => mcpBridge.discoverServerTools(server),
    }),
  );
  app.route("/api/v1/mcp-servers", mcpServersApp);

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

  const adminApp = new Hono<{ Variables: AuthedVariables }>();
  adminApp.use("*", authMiddleware);
  adminApp.route(
    "/",
    createAdminRoutes({
      da: createPgHealthHistoryDataAccess(),
      adminDa: createPgAdminDataAccess(),
    }),
  );
  app.route("/api/v1/admin", adminApp);

  const configApp = new Hono<{ Variables: AuthedVariables }>();
  configApp.use("*", authMiddleware);
  configApp.route(
    "/",
    createConfigRoutes({
      organizations: authDa.organizations,
      models: provider.models,
    }),
  );
  app.route("/api/v1/config", configApp);

  return app;
}

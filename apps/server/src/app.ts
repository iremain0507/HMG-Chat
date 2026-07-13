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
import { createPgHealthHistoryDataAccess } from "./db/health-history-data-access.js";
import { createPgAdminDataAccess } from "./db/admin-data-access.js";
import { createSkillRegistry } from "./tools/skills-engine.js";
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
import { setActiveRun } from "./db/active-runs-service.js";

const DEFAULT_MODEL = "claude-sonnet-4-6";

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

  app.route(
    "/api/v1/auth",
    createAuthRoutes({
      da: createPgAuthDataAccess(),
      emailSender: createEmailSender(env.EMAIL_SENDER_KIND),
      allowedDomains: env.ALLOWED_DOMAINS.split(",").map((d) => d.trim()),
      appOrigin,
      secureCookies: env.NODE_ENV === "production",
    }),
  );

  // ANTHROPIC_API_KEY 미설정(dev/CI) 시 실 네트워크 호출 없는 dev-stub 으로 fail-soft.
  const provider = env.ANTHROPIC_API_KEY
    ? createAnthropicLLMProvider({
        client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      })
    : createDevStubLLMProvider();

  const sessionsApp = new Hono<{ Variables: AuthedVariables }>();
  sessionsApp.use("*", authMiddleware);
  sessionsApp.route("/", createSessionRoutes());
  sessionsApp.route(
    "/",
    createMessageRoutes({
      provider,
      model: provider.models[0] ?? DEFAULT_MODEL,
      activeRuns: { setActiveRun },
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
  const artifactDa = createPgArtifactDataAccess();
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

  const mcpServerDa = createPgMcpServerDataAccess();
  const mcpBridge = createMcpBridge({
    pool: createMcpClientPool({ da: mcpServerDa }),
  });
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

  return app;
}

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
  artifactsApp.route(
    "/",
    createArtifactRoutes({
      da: artifactDa,
      inlineStore: createInlineArtifactStore(artifactDa.artifacts),
      s3Store: createS3ArtifactStore(createLocalObjectStore()),
      downloadSecret: env.JWT_SECRET,
    }),
  );
  app.route("/api/v1/artifacts", artifactsApp);

  return app;
}

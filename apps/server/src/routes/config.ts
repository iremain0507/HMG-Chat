// routes/config.ts — 16-API-CONTRACT.md § 12 GET /config 단일 출처.
// 클라이언트 부트스트랩: availableModels = 레지스트리 models(provider.models, P11-T2-03) ∩
// org.allowedModels(DB 화이트리스트, model-router.ts selectModel 이 같은 필드로 검증) — 순서는
// 레지스트리 순서 보존. availableTools 는 org.allowedTools 를 그대로 노출.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { Organization } from "@wchat/interfaces";

const FEATURES = {
  artifactShare: true,
  memory: true,
} as const;

export interface ConfigRouteDeps {
  organizations: { byId(id: string): Promise<Organization | null> };
  models: string[];
}

export function createConfigRoutes(
  deps: ConfigRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const org = await deps.organizations.byId(c.get("auth").org);
    const allowedModels = new Set(org?.allowedModels ?? []);
    const availableModels = deps.models.filter((m) => allowedModels.has(m));
    return c.json({
      data: {
        availableModels,
        availableTools: org?.allowedTools ?? [],
        features: FEATURES,
      },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

// routes/config.ts — 16-API-CONTRACT.md § 12 GET /config 단일 출처.
// 클라이언트 부트스트랩: availableModels = 레지스트리 models(provider.models, P11-T2-03) ∩
// org.allowedModels(DB 화이트리스트, model-router.ts selectModel 이 같은 필드로 검증) — 순서는
// 레지스트리 순서 보존. availableTools 는 org.allowedTools 를 그대로 노출.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { Organization } from "@wchat/interfaces";
import type { ResolvedOrgSettings } from "../lib/org-settings-schema.js";

const FEATURES = {
  artifactShare: true,
  memory: true,
} as const;

export interface ConfigRouteDeps {
  organizations: { byId(id: string): Promise<Organization | null> };
  models: string[];
  settings?: { resolve(orgId: string): Promise<ResolvedOrgSettings> };
}

export function createConfigRoutes(
  deps: ConfigRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const org = await deps.organizations.byId(auth.org);
    const allowedModels = new Set(org?.allowedModels ?? []);
    const availableModels = deps.models.filter((m) => allowedModels.has(m));
    const settings = await deps.settings?.resolve(auth.org);
    return c.json({
      data: {
        availableModels,
        availableTools: org?.allowedTools ?? [],
        features: FEATURES,
        banner: settings?.banner ?? [],
      },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

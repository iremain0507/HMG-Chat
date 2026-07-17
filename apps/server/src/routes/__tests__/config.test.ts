// config.test.ts — P11-T1-01 RED: routes/config.ts 가 createConfigRoutes 를 export 안함.
// 16-API-CONTRACT § 12 — GET /config 는 { availableModels, availableTools, features } 를
// 반환한다. availableModels = 레지스트리 models(provider.models) ∩ org.allowedModels
// (순서는 레지스트리 순서 보존).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { Organization } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createConfigRoutes } from "../config.js";
import { DEFAULT_ORG_SETTINGS } from "../../lib/org-settings-schema.js";

function makeOrgDa(seed: Organization[] = []) {
  const rows = [...seed];
  return {
    async byId(id: string) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: randomUUID(),
    name: "Org",
    domain: "example.com",
    plan: "standard",
    allowedModels: [],
    allowedTools: [],
    defaultTokenBudgetMicros: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSettings(banner: unknown[] = []) {
  return {
    async resolve() {
      return { ...DEFAULT_ORG_SETTINGS, banner };
    },
  };
}

function appWith(
  organizations: ReturnType<typeof makeOrgDa>,
  models: string[],
  actor: { userId: string; orgId: string },
  settings: ReturnType<typeof makeSettings> = makeSettings(),
) {
  const routes = createConfigRoutes({ organizations, models, settings });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

let userId: string;

beforeEach(() => {
  userId = randomUUID();
});

describe("createConfigRoutes", () => {
  it("GET / — availableModels 는 레지스트리 models ∩ org.allowedModels (레지스트리 순서 보존)", async () => {
    const org = makeOrg({
      allowedModels: ["claude-sonnet-4-6", "gpt-5.1"],
    });
    const da = makeOrgDa([org]);
    const app = appWith(
      da,
      ["claude-opus-4-7", "claude-sonnet-4-6", "gpt-5.1", "gemini-2.5-pro"],
      { userId, orgId: org.id },
    );

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        availableModels: string[];
        availableTools: string[];
        features: Record<string, boolean>;
      };
    };
    expect(body.data.availableModels).toEqual(["claude-sonnet-4-6", "gpt-5.1"]);
  });

  it("GET / — org.allowedModels 밖의 모델은 노출하지 않는다", async () => {
    const org = makeOrg({ allowedModels: ["dev-stub"] });
    const da = makeOrgDa([org]);
    const app = appWith(da, ["claude-opus-4-7", "dev-stub"], {
      userId,
      orgId: org.id,
    });

    const res = await app.request("/");
    const body = (await res.json()) as {
      data: { availableModels: string[] };
    };
    expect(body.data.availableModels).toEqual(["dev-stub"]);
    expect(body.data.availableModels).not.toContain("claude-opus-4-7");
  });

  it("GET / — availableTools 는 org.allowedTools 를 반환한다", async () => {
    const org = makeOrg({ allowedTools: ["artifact_create"] });
    const da = makeOrgDa([org]);
    const app = appWith(da, [], { userId, orgId: org.id });

    const res = await app.request("/");
    const body = (await res.json()) as { data: { availableTools: string[] } };
    expect(body.data.availableTools).toEqual(["artifact_create"]);
  });

  it("GET / — features 를 반환한다", async () => {
    const org = makeOrg();
    const da = makeOrgDa([org]);
    const app = appWith(da, [], { userId, orgId: org.id });

    const res = await app.request("/");
    const body = (await res.json()) as {
      data: { features: Record<string, boolean> };
    };
    expect(body.data.features).toEqual(
      expect.objectContaining({ artifactShare: true, memory: true }),
    );
  });

  it("GET / — org 를 찾지 못하면 availableModels/availableTools 를 빈 배열로 반환한다", async () => {
    const da = makeOrgDa([]);
    const app = appWith(da, ["claude-opus-4-7"], {
      userId,
      orgId: randomUUID(),
    });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { availableModels: string[]; availableTools: string[] };
    };
    expect(body.data.availableModels).toEqual([]);
    expect(body.data.availableTools).toEqual([]);
  });

  // P19-T6-15: GET /api/v1/admin/settings 는 isAdmin 게이트라 일반 멤버는 못 본다 —
  // banner 는 이 authMiddleware-only 부트스트랩 경로로 노출해야 role 무관하게 실제로 뜬다.
  it("GET / — org_settings 의 typed 배너 목록을 role 무관하게 반환한다(member)", async () => {
    const org = makeOrg();
    const da = makeOrgDa([org]);
    const settings = makeSettings([
      { type: "warning", content: "점검 예정", dismissible: true },
    ]);
    const app = appWith(da, [], { userId, orgId: org.id }, settings);

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { banner: Array<{ type: string; content: string }> };
    };
    expect(body.data.banner).toEqual([
      { type: "warning", content: "점검 예정", dismissible: true },
    ]);
  });

  it("GET / — 배너 미설정 시 빈 배열을 반환한다", async () => {
    const org = makeOrg();
    const da = makeOrgDa([org]);
    const app = appWith(da, [], { userId, orgId: org.id });

    const res = await app.request("/");
    const body = (await res.json()) as { data: { banner: unknown[] } };
    expect(body.data.banner).toEqual([]);
  });
});

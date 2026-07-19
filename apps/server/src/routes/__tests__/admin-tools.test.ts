// admin-tools.test.ts — P22-T6-02: routes/admin-tools.ts GET/PUT '/' 단위 검증(DB 불필요).
//   allowedModels(admin-models) 패턴을 그대로 반영: admin-only(비admin 403), Zod 검증(400),
//   PUT 후 GET 반영, orgId 는 auth(JWT)에서만 파생(cross-org 불가). fake organizations dep 주입.
import { describe, it, expect, vi } from "vitest";
import { Hono } from "hono";
import type { Organization } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createAdminToolsRoutes } from "../admin-tools.js";

type AuthLike = { sub: string; org: string; role: string };

function makeOrgStore(seed: Record<string, string[]> = {}) {
  const store = new Map<string, string[]>(Object.entries(seed));
  return {
    store,
    organizations: {
      async byId(id: string): Promise<Organization | null> {
        if (!store.has(id)) return null;
        return { id, allowedTools: store.get(id) ?? [] } as Organization;
      },
      async update(
        id: string,
        data: { allowedTools: string[] },
      ): Promise<Organization> {
        store.set(id, data.allowedTools);
        return { id, allowedTools: data.allowedTools } as Organization;
      },
    },
  };
}

// 테스트 하네스: 실 authMiddleware 대신 주입한 auth 로 c.set("auth") 후 라우트 마운트.
function mountWithAuth(
  deps: Parameters<typeof createAdminToolsRoutes>[0],
  auth: AuthLike | null,
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    if (auth) c.set("auth", auth as never);
    await next();
  });
  app.route("/", createAdminToolsRoutes(deps));
  return app;
}

describe("createAdminToolsRoutes — P22-T6-02", () => {
  it("admin GET '/' 은 org.allowedTools 를 {data,meta} 로 반환", async () => {
    const { organizations } = makeOrgStore({ "org-1": ["web_search"] });
    const app = mountWithAuth(
      { organizations },
      { sub: "u1", org: "org-1", role: "admin" },
    );
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { allowedTools: string[] };
      meta: { requestId: string };
    };
    expect(body.data.allowedTools).toEqual(["web_search"]);
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("member GET/PUT '/' → 403 FORBIDDEN", async () => {
    const { organizations } = makeOrgStore({ "org-1": [] });
    const app = mountWithAuth(
      { organizations },
      { sub: "u2", org: "org-1", role: "member" },
    );
    const getRes = await app.request("/");
    expect(getRes.status).toBe(403);
    const putRes = await app.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedTools: ["web_search"] }),
    });
    expect(putRes.status).toBe(403);
  });

  it("admin PUT 잘못된 body → 400 INVALID_INPUT", async () => {
    const { organizations } = makeOrgStore({ "org-1": [] });
    const app = mountWithAuth(
      { organizations },
      { sub: "u1", org: "org-1", role: "admin" },
    );
    const res = await app.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedTools: [1, 2] }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("admin PUT 후 GET 이 변경을 반영하고 audit 를 기록한다", async () => {
    const { organizations, store } = makeOrgStore({ "org-1": [] });
    const record = vi.fn(async () => {});
    const app = mountWithAuth(
      { organizations, audit: { record } },
      { sub: "u1", org: "org-1", role: "admin" },
    );
    const putRes = await app.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        allowedTools: ["web_search", "code_interpreter"],
      }),
    });
    expect(putRes.status).toBe(200);
    expect(store.get("org-1")).toEqual(["web_search", "code_interpreter"]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        action: "admin.tools.updated",
      }),
    );
    const getRes = await app.request("/");
    const getBody = (await getRes.json()) as {
      data: { allowedTools: string[] };
    };
    expect(getBody.data.allowedTools).toEqual([
      "web_search",
      "code_interpreter",
    ]);
  });

  it("orgId 는 auth 에서만 파생 — org A PUT 이 org B 를 건드리지 않는다", async () => {
    const { organizations, store } = makeOrgStore({
      "org-a": [],
      "org-b": ["existing"],
    });
    const app = mountWithAuth(
      { organizations },
      { sub: "u1", org: "org-a", role: "admin" },
    );
    // body 에 다른 org 를 넣어도 무시(스키마에 org 필드 없음), auth.org 만 사용.
    await app.request("/", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowedTools: ["x"], org: "org-b" }),
    });
    expect(store.get("org-a")).toEqual(["x"]);
    expect(store.get("org-b")).toEqual(["existing"]);
  });
});

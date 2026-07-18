// agents.test.ts — P22-T6-10 RED: routes/agents.ts 가 존재하지 않는다(에이전트 레지스트리 부재).
// 갭 카탈로그 P22-T6-10 acceptance 중 서버측을 검증한다:
//   (1) POST /agents → 201 + Agent 레코드, GET /agents 가 자기 org 범위로만 목록
//   (2) 다른 org 의 에이전트는 GET/PATCH/DELETE /agents/:id 에서 404 (existence-leak 방지)
//   (3) visibility=private 은 작성자에게만 보이고 org 는 같은 org 전원에게 보인다
// mcp-servers.test.ts / openapi-tool-servers.test.ts 와 동일한 fake DA + 주입 auth 패턴.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Agent } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createAgentRoutes } from "../agents.js";
import type { AgentDataAccess } from "../../db/agent-data-access.js";

function makeDa(seed: Agent[] = []): AgentDataAccess {
  const rows: Agent[] = [...seed];
  return {
    agents: {
      async insert(data) {
        const now = new Date();
        const row: Agent = {
          id: randomUUID(),
          orgId: data.orgId as string,
          name: data.name as string,
          description: data.description ?? null,
          baseModel: data.baseModel as string,
          systemPrompt: data.systemPrompt ?? null,
          toolIds: data.toolIds ?? [],
          skillIds: data.skillIds ?? [],
          projectIds: data.projectIds ?? [],
          visibility: data.visibility ?? "private",
          createdBy: data.createdBy as string,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
        return row;
      },
      async bulkInsert(items) {
        const out: Agent[] = [];
        for (const item of items) out.push(await this.insert(item));
        return out;
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        const next = {
          ...(rows[idx] as Agent),
          ...data,
          updatedAt: new Date(),
        } as Agent;
        rows[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.createdBy === undefined ||
                r.createdBy === filter.createdBy) &&
              (filter?.visibility === undefined ||
                r.visibility === filter.visibility),
          ),
        };
      },
    },
  };
}

function appWith(
  da: AgentDataAccess,
  actor: { userId: string; orgId: string; role?: "member" | "admin" },
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role ?? "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", createAgentRoutes({ da }));
  return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

function seedAgent(over: Partial<Agent> = {}): Agent {
  const now = new Date();
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    name: "시드 에이전트",
    description: null,
    baseModel: "claude-sonnet-5",
    systemPrompt: null,
    toolIds: [],
    skillIds: [],
    projectIds: [],
    visibility: "org",
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

let userId: string;
let orgId: string;
let otherOrgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
  otherOrgId = randomUUID();
});

describe("createAgentRoutes", () => {
  it("POST / — 201 로 Agent 레코드를 반환하고 GET / 목록에 나타난다", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "설계 리뷰어",
        baseModel: "claude-sonnet-5",
        systemPrompt: "너는 설계 리뷰어다.",
        toolIds: ["web_search"],
        visibility: "org",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.name).toBe("설계 리뷰어");
    expect(body.data.orgId).toBe(orgId);
    expect(body.data.createdBy).toBe(userId);
    expect(body.data.toolIds).toEqual(["web_search"]);
    expect(body.data.visibility).toBe("org");
    expect(typeof body.data.createdAt).toBe("string");

    const listRes = await app.request("/");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.id).toBe(body.data.id);
  });

  it("POST / — name 이 없으면 400 INVALID_INPUT", async () => {
    const app = appWith(makeDa(), { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ baseModel: "claude-sonnet-5" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("POST / — baseModel 이 없으면 400 INVALID_INPUT", async () => {
    const app = appWith(makeDa(), { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "이름만" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST / — 같은 org 안에서 이름이 중복되면 409 CONFLICT", async () => {
    const da = makeDa([seedAgent({ orgId, name: "중복", createdBy: userId })]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "중복", baseModel: "claude-sonnet-5" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("GET / — 다른 org 의 에이전트는 목록에 포함되지 않는다", async () => {
    const da = makeDa([
      seedAgent({ orgId, name: "내 것", createdBy: userId }),
      seedAgent({ orgId: otherOrgId, name: "남의 것" }),
    ]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request("/");
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((a) => a.name)).toEqual(["내 것"]);
  });

  it("GET / — 다른 사용자의 private 에이전트는 숨기고 org 공개는 노출한다", async () => {
    const other = randomUUID();
    const da = makeDa([
      seedAgent({
        orgId,
        name: "남의 비공개",
        createdBy: other,
        visibility: "private",
      }),
      seedAgent({
        orgId,
        name: "조직 공개",
        createdBy: other,
        visibility: "org",
      }),
      seedAgent({
        orgId,
        name: "내 비공개",
        createdBy: userId,
        visibility: "private",
      }),
    ]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request("/");
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((a) => a.name).sort()).toEqual(
      ["내 비공개", "조직 공개"].sort(),
    );
  });

  it("GET /:id — 다른 org 의 에이전트는 404", async () => {
    const foreign = seedAgent({ orgId: otherOrgId });
    const app = appWith(makeDa([foreign]), { userId, orgId });
    const res = await app.request(`/${foreign.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("GET /:id — 같은 org 의 에이전트는 200", async () => {
    const mine = seedAgent({ orgId, createdBy: userId });
    const app = appWith(makeDa([mine]), { userId, orgId });
    const res = await app.request(`/${mine.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(mine.id);
  });

  it("PATCH /:id — 필드를 갱신하고 갱신된 레코드를 반환한다", async () => {
    const mine = seedAgent({ orgId, createdBy: userId, name: "옛 이름" });
    const app = appWith(makeDa([mine]), { userId, orgId });
    const res = await app.request(`/${mine.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "새 이름", systemPrompt: "바뀐 프롬프트" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { name: string; systemPrompt: string };
    };
    expect(body.data.name).toBe("새 이름");
    expect(body.data.systemPrompt).toBe("바뀐 프롬프트");
  });

  it("PATCH /:id — 다른 org 의 에이전트는 404", async () => {
    const foreign = seedAgent({ orgId: otherOrgId });
    const app = appWith(makeDa([foreign]), { userId, orgId });
    const res = await app.request(`/${foreign.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "탈취" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — 204 후 목록에서 사라진다", async () => {
    const mine = seedAgent({ orgId, createdBy: userId });
    const app = appWith(makeDa([mine]), { userId, orgId });
    const res = await app.request(`/${mine.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const list = (await (await app.request("/")).json()) as { data: unknown[] };
    expect(list.data).toHaveLength(0);
  });

  it("DELETE /:id — 다른 org 의 에이전트는 404 이고 삭제되지 않는다", async () => {
    const foreign = seedAgent({ orgId: otherOrgId });
    const da = makeDa([foreign]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${foreign.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await da.agents.byId(foreign.id)).not.toBeNull();
  });

  it("DELETE /:id — 다른 사용자의 private 에이전트는 404", async () => {
    const other = seedAgent({
      orgId,
      createdBy: randomUUID(),
      visibility: "private",
    });
    const app = appWith(makeDa([other]), { userId, orgId });
    const res = await app.request(`/${other.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

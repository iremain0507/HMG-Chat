// connections.test.ts — P22-T6-14 RED: routes/connections.ts 가 존재하지 않는다
// (외부 OpenAI 호환 provider 를 base URL + API 키로 등록/검증/활성화하는 경로 전무).
// 갭 카탈로그 P22-T6-14 acceptance 중 서버측을 검증한다:
//   (1) POST /connections → 201, 키는 암호화 저장되고 응답/재조회에는 keyPrefix 만 노출
//   (2) POST /connections/:id/verify → base URL 로 스코프된 프로브, verified/failed 반영
//       (키 전문은 응답에 절대 실리지 않음)
//   (3) 다른 org 의 연결은 GET/PATCH/DELETE/verify 에서 404 (existence-leak 방지)
//   (4) SSRF: 사설/루프백 base URL 은 등록 자체가 400
// agents.test.ts / mcp-servers.test.ts 와 동일한 fake DA + 주입 auth 패턴.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ProviderConnection } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createConnectionRoutes } from "../connections.js";
import type { ProviderConnectionDataAccess } from "../../db/provider-connection-data-access.js";

function makeDa(seed: Array<{ row: ProviderConnection; secret: string }> = []) {
  const rows: ProviderConnection[] = seed.map((s) => s.row);
  const secrets = new Map<string, string>(
    seed.map((s) => [s.row.id, s.secret]),
  );
  const da: ProviderConnectionDataAccess = {
    providerConnections: {
      async insertWithSecret(data, apiKey) {
        const now = new Date();
        const row: ProviderConnection = {
          id: randomUUID(),
          orgId: data.orgId,
          name: data.name,
          kind: data.kind,
          baseUrl: data.baseUrl,
          keyPrefix: `${apiKey.slice(0, 6)}…`,
          enabled: data.enabled,
          verifiedAt: null,
          models: data.models,
          createdBy: data.createdBy,
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
        secrets.set(row.id, apiKey);
        return row;
      },
      async insert() {
        throw new Error("insertWithSecret 를 사용하세요");
      },
      async bulkInsert() {
        throw new Error("미지원");
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        const next = {
          ...(rows[idx] as ProviderConnection),
          ...data,
          updatedAt: new Date(),
        } as ProviderConnection;
        rows[idx] = next;
        return next;
      },
      async updateSecret(id, apiKey) {
        secrets.set(id, apiKey);
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) {
          rows[idx] = {
            ...(rows[idx] as ProviderConnection),
            keyPrefix: `${apiKey.slice(0, 6)}…`,
          };
        }
      },
      async secretById(id) {
        return secrets.get(id) ?? null;
      },
      async markVerified(id, verifiedAt) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) {
          rows[idx] = { ...(rows[idx] as ProviderConnection), verifiedAt };
        }
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
        secrets.delete(id);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.enabled === undefined || r.enabled === filter.enabled),
          ),
        };
      },
    },
  };
  return { da, secrets };
}

function appWith(
  da: ProviderConnectionDataAccess,
  actor: { userId: string; orgId: string; role?: "member" | "admin" },
  probe?: (
    baseUrl: string,
    apiKey: string,
  ) => Promise<{ ok: boolean; models?: string[]; message?: string }>,
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role ?? "admin",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route(
    "/",
    createConnectionRoutes({
      da,
      probe: probe ?? (async () => ({ ok: true, models: ["gpt-5.1"] })),
      // 실 SSRF validator(mcp/url-validator.ts)를 그대로 쓰되 DNS 만 스텁 —
      // 테스트가 네트워크에 의존하지 않게 하면서 deny-CIDR 판정 로직은 진짜를 검증한다.
      urlValidatorOptions: {
        nodeEnv: "test",
        resolveHostname: async (hostname: string) =>
          hostname === "localhost" ? ["127.0.0.1"] : ["93.184.216.34"],
      },
    }),
  );
  return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

function seedConnection(over: Partial<ProviderConnection> = {}) {
  const now = new Date();
  const row: ProviderConnection = {
    id: randomUUID(),
    orgId: randomUUID(),
    name: "시드 연결",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    keyPrefix: "sk-see…",
    enabled: true,
    verifiedAt: null,
    models: ["gpt-5.1"],
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
  return { row, secret: "sk-seedsecretvalue" };
}

let userId: string;
let orgId: string;
let otherOrgId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
  otherOrgId = randomUUID();
});

describe("createConnectionRoutes", () => {
  it("POST / — 201 + keyPrefix 만 노출하고, 평문 키는 응답 어디에도 없다", async () => {
    const { da, secrets } = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "사내 GPT",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-supersecret-full-key",
        models: ["gpt-5.1"],
      }),
    });

    expect(res.status).toBe(201);
    const raw = await res.text();
    expect(raw).not.toContain("sk-supersecret-full-key");
    const body = JSON.parse(raw);
    expect(body.data.name).toBe("사내 GPT");
    expect(body.data.baseUrl).toBe("https://api.example.com/v1");
    expect(body.data.keyPrefix).toContain("…");
    expect(body.data.apiKey).toBeUndefined();
    // 키는 DA 의 secret 저장소에만 존재한다.
    expect(await da.providerConnections.secretById(body.data.id)).toBe(
      "sk-supersecret-full-key",
    );
    expect([...secrets.values()]).toContain("sk-supersecret-full-key");
  });

  it("GET / — 자기 org 연결만 목록에 나오고 재조회에도 keyPrefix 만 있다", async () => {
    const mine = seedConnection({ orgId, name: "내 연결" });
    const theirs = seedConnection({ orgId: otherOrgId, name: "남의 연결" });
    const { da } = makeDa([mine, theirs]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("내 연결");
    expect(body.data[0].keyPrefix).toBe("sk-see…");
    expect(body.data[0].apiKey).toBeUndefined();
  });

  it("POST /:id/verify — 프로브 성공 시 verifiedAt 이 채워지고 models 가 갱신된다", async () => {
    const mine = seedConnection({ orgId, models: [] });
    const { da } = makeDa([mine]);
    const seen: Array<{ baseUrl: string; apiKey: string }> = [];
    const app = appWith(da, { userId, orgId }, async (baseUrl, apiKey) => {
      seen.push({ baseUrl, apiKey });
      return { ok: true, models: ["gpt-5.1", "gpt-5.1-mini"] };
    });

    const res = await app.request(`/${mine.row.id}/verify`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.verified).toBe(true);
    expect(body.data.connection.verifiedAt).not.toBeNull();
    expect(body.data.connection.models).toEqual(["gpt-5.1", "gpt-5.1-mini"]);
    // 프로브는 저장된 실 키로 호출되지만 응답에는 실리지 않는다.
    expect(seen).toEqual([
      { baseUrl: mine.row.baseUrl, apiKey: "sk-seedsecretvalue" },
    ]);
    expect(JSON.stringify(body)).not.toContain("sk-seedsecretvalue");
  });

  it("POST /:id/verify — 프로브 실패 시 verified=false 이고 verifiedAt 은 비워진다", async () => {
    const mine = seedConnection({ orgId, verifiedAt: new Date() });
    const { da } = makeDa([mine]);
    const app = appWith(da, { userId, orgId }, async () => ({
      ok: false,
      message: "401 Unauthorized",
    }));

    const res = await app.request(`/${mine.row.id}/verify`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.verified).toBe(false);
    expect(body.data.connection.verifiedAt).toBeNull();
    expect(body.data.message).toContain("401");
  });

  it("PATCH /:id — enabled 토글과 apiKey 교체가 반영되고 keyPrefix 가 갱신된다", async () => {
    const mine = seedConnection({ orgId, enabled: true });
    const { da } = makeDa([mine]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request(`/${mine.row.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ enabled: false, apiKey: "sk-rotated-new-key" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
    expect(body.data.keyPrefix).toBe("sk-rot…");
    expect(await da.providerConnections.secretById(mine.row.id)).toBe(
      "sk-rotated-new-key",
    );
  });

  it("다른 org 의 연결은 GET/PATCH/DELETE/verify 모두 404 (existence-leak 방지)", async () => {
    const theirs = seedConnection({ orgId: otherOrgId });
    const { da } = makeDa([theirs]);
    const app = appWith(da, { userId, orgId });
    const id = theirs.row.id;

    expect((await app.request(`/${id}`)).status).toBe(404);
    expect(
      (
        await app.request(`/${id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify({ enabled: false }),
        })
      ).status,
    ).toBe(404);
    expect((await app.request(`/${id}`, { method: "DELETE" })).status).toBe(
      404,
    );
    expect(
      (await app.request(`/${id}/verify`, { method: "POST" })).status,
    ).toBe(404);
    // 남의 연결이 지워지지도 않았다.
    expect(await da.providerConnections.byId(id)).not.toBeNull();
  });

  it("SSRF — 사설/루프백 base URL 은 400 으로 등록 거부", async () => {
    const { da } = makeDa();
    const app = appWith(da, { userId, orgId });

    for (const baseUrl of [
      "http://127.0.0.1:11434/v1",
      "http://localhost:8080/v1",
      "http://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
    ]) {
      const res = await app.request("/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: `n-${baseUrl}`, baseUrl, apiKey: "sk-x" }),
      });
      expect(res.status, baseUrl).toBe(400);
    }
    expect((await da.providerConnections.list({ orgId })).items).toHaveLength(
      0,
    );
  });

  it("POST / — 같은 org 안 이름 중복은 409", async () => {
    const mine = seedConnection({ orgId, name: "중복" });
    const { da } = makeDa([mine]);
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        name: "중복",
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-y",
      }),
    });
    expect(res.status).toBe(409);
  });

  it("DELETE /:id — 204 후 목록에서 사라진다", async () => {
    const mine = seedConnection({ orgId });
    const { da } = makeDa([mine]);
    const app = appWith(da, { userId, orgId });

    expect(
      (await app.request(`/${mine.row.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await da.providerConnections.list({ orgId })).items).toHaveLength(
      0,
    );
  });
});

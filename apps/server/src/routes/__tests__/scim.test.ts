// scim.test.ts — P22-T1-16(계약배치 C15) RED: routes/scim.ts 가 없다(모듈 부재).
// 갭 카탈로그 P22-T1-16 acceptance 4건을 검증한다:
//   (1) Bearer 토큰 + SCIM 2.0 POST /Users → externalId 로 user 생성/연결 후 201 + User 리소스
//   (2) PATCH /Users/{id} active=false → 비활성(soft-disable, 인증 불가) + 200
//   (3) /scim/v2 prefix 가 createApp 에 마운트(routes-mounted.test.ts EXPECTED_ROUTES)
//   (4) Group 생성/멤버 갱신이 기존 groups/group_members 에 반영되고 GET /Groups/{id} 로 읽힌다
// 인증은 사용자 JWT 가 아니라 IdP 전용 Bearer(scim_tokens) — authMiddleware 밖 마운트라
// 라우트가 직접 토큰→orgId 를 해석하고 org 경계를 강제한다(cross-org 는 404, existence-leak 방지).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { createScimRoutes } from "../scim.js";
import type {
  ScimDataAccess,
  ScimGroupRecord,
  ScimUserRecord,
} from "../../db/scim-data-access.js";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const TOKEN_A = "scim_token_for_org_a";
const TOKEN_B = "scim_token_for_org_b";

function createFakeScimDa(): ScimDataAccess {
  const users = new Map<string, ScimUserRecord>();
  const groups = new Map<string, ScimGroupRecord>();
  const tokens = new Map<string, string>([
    [TOKEN_A, ORG_A],
    [TOKEN_B, ORG_B],
  ]);
  const now = new Date("2026-07-18T00:00:00.000Z");

  function scoped<T extends { orgId: string }>(
    map: Map<string, T>,
    orgId: string,
  ): T[] {
    return [...map.values()].filter((r) => r.orgId === orgId);
  }

  return {
    async resolveToken(raw) {
      const orgId = tokens.get(raw);
      return orgId ? { orgId } : null;
    },
    async listUsers(orgId, opts) {
      let items = scoped(users, orgId);
      if (opts.email) items = items.filter((u) => u.email === opts.email);
      if (opts.externalId)
        items = items.filter((u) => u.externalId === opts.externalId);
      const total = items.length;
      const start = Math.max(1, opts.startIndex) - 1;
      return { items: items.slice(start, start + opts.count), total };
    },
    async userById(orgId, id) {
      const found = users.get(id);
      return found && found.orgId === orgId ? found : null;
    },
    async userByEmail(orgId, email) {
      return scoped(users, orgId).find((u) => u.email === email) ?? null;
    },
    async createUser(orgId, data) {
      const record: ScimUserRecord = {
        id: randomUUID(),
        orgId,
        email: data.email,
        name: data.name,
        role: "member",
        status: data.active ? "active" : "suspended",
        externalId: data.externalId,
        createdAt: now,
        updatedAt: now,
      };
      users.set(record.id, record);
      return record;
    },
    async updateUser(orgId, id, data) {
      const found = users.get(id);
      if (!found || found.orgId !== orgId) return null;
      const next: ScimUserRecord = {
        ...found,
        email: data.email ?? found.email,
        name: data.name !== undefined ? data.name : found.name,
        externalId:
          data.externalId !== undefined ? data.externalId : found.externalId,
        status:
          data.active === undefined
            ? found.status
            : data.active
              ? "active"
              : "suspended",
      };
      users.set(id, next);
      return next;
    },
    async listGroups(orgId, opts) {
      let items = scoped(groups, orgId);
      if (opts.displayName)
        items = items.filter((g) => g.name === opts.displayName);
      const total = items.length;
      const start = Math.max(1, opts.startIndex) - 1;
      return { items: items.slice(start, start + opts.count), total };
    },
    async groupById(orgId, id) {
      const found = groups.get(id);
      return found && found.orgId === orgId ? found : null;
    },
    async groupByName(orgId, name) {
      return scoped(groups, orgId).find((g) => g.name === name) ?? null;
    },
    async createGroup(orgId, data) {
      const record: ScimGroupRecord = {
        id: randomUUID(),
        orgId,
        name: data.name,
        externalId: data.externalId,
        // 멤버는 같은 org 의 실존 user 만 (group_members FK + org 이중 방어 미러)
        memberUserIds: data.memberUserIds.filter(
          (uid) => users.get(uid)?.orgId === orgId,
        ),
        createdAt: now,
        updatedAt: now,
      };
      groups.set(record.id, record);
      return record;
    },
    async updateGroup(orgId, id, data) {
      const found = groups.get(id);
      if (!found || found.orgId !== orgId) return null;
      const next: ScimGroupRecord = {
        ...found,
        name: data.name ?? found.name,
        externalId:
          data.externalId !== undefined ? data.externalId : found.externalId,
        memberUserIds: data.memberUserIds
          ? data.memberUserIds.filter((uid) => users.get(uid)?.orgId === orgId)
          : found.memberUserIds,
      };
      groups.set(id, next);
      return next;
    },
    async deleteGroup(orgId, id) {
      const found = groups.get(id);
      if (!found || found.orgId !== orgId) return false;
      groups.delete(id);
      return true;
    },
  };
}

let da: ScimDataAccess;
let app: ReturnType<typeof createScimRoutes>;

function req(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  const { token = TOKEN_A, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (rest.body) headers.set("content-type", "application/scim+json");
  return app.request(`http://localhost${path}`, { ...rest, headers });
}

async function createUser(
  userName: string,
  externalId: string,
  token = TOKEN_A,
): Promise<Record<string, unknown>> {
  const res = await req("/Users", {
    method: "POST",
    token,
    body: JSON.stringify({
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName,
      externalId,
      name: { givenName: "길동", familyName: "홍" },
      emails: [{ value: userName, primary: true }],
      active: true,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  da = createFakeScimDa();
  app = createScimRoutes({ da });
});

describe("SCIM 2.0 — 인증(IdP Bearer)", () => {
  it("Authorization 헤더가 없으면 401 SCIM Error 를 반환한다", async () => {
    const res = await req("/Users", { token: null });
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
    expect(body.status).toBe("401");
  });

  it("알 수 없는 Bearer 토큰은 401", async () => {
    const res = await req("/Users", { token: "not-a-real-token" });
    expect(res.status).toBe(401);
  });

  it("ServiceProviderConfig 는 인증 없이도 읽을 수 있다(디스커버리)", async () => {
    const res = await req("/ServiceProviderConfig", { token: null });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
    ]);
    expect(body.patch).toEqual({ supported: true });
  });

  it("ResourceTypes/Schemas 디스커버리가 User·Group 을 노출한다", async () => {
    const types = (await (
      await req("/ResourceTypes", { token: null })
    ).json()) as { Resources: Array<{ id: string }> };
    expect(types.Resources.map((r) => r.id).sort()).toEqual(["Group", "User"]);
    const schemas = (await (await req("/Schemas", { token: null })).json()) as {
      Resources: Array<{ id: string }>;
    };
    expect(schemas.Resources.map((r) => r.id)).toContain(
      "urn:ietf:params:scim:schemas:core:2.0:User",
    );
  });
});

describe("SCIM 2.0 — /Users 프로비저닝", () => {
  it("유효한 payload 로 POST 하면 201 + User 리소스(externalId 연결)를 반환한다", async () => {
    const body = await createUser("hong@example.com", "idp-uid-1");
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:schemas:core:2.0:User",
    ]);
    expect(body.userName).toBe("hong@example.com");
    expect(body.externalId).toBe("idp-uid-1");
    expect(body.active).toBe(true);
    expect(typeof body.id).toBe("string");
    expect((body.meta as Record<string, unknown>).resourceType).toBe("User");
  });

  it("같은 userName 을 다시 POST 하면 409 uniqueness", async () => {
    await createUser("dup@example.com", "idp-uid-2");
    const res = await req("/Users", {
      method: "POST",
      body: JSON.stringify({ userName: "dup@example.com" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.scimType).toBe("uniqueness");
  });

  it("userName 이 없으면 400 invalidValue", async () => {
    const res = await req("/Users", {
      method: "POST",
      body: JSON.stringify({ externalId: "x" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).scimType).toBe("invalidValue");
  });

  it('filter=userName eq "..." 로 ListResponse 를 조회한다', async () => {
    await createUser("a@example.com", "idp-a");
    await createUser("b@example.com", "idp-b");
    const res = await req(
      `/Users?filter=${encodeURIComponent('userName eq "a@example.com"')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:ListResponse",
    ]);
    expect(body.totalResults).toBe(1);
    expect((body.Resources as Array<Record<string, unknown>>)[0].userName).toBe(
      "a@example.com",
    );
  });

  it("PATCH active=false 는 사용자를 비활성(soft-disable)하고 200 을 반환한다", async () => {
    const created = await createUser("off@example.com", "idp-off");
    const res = await req(`/Users/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "active", value: false }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).active).toBe(false);
    // 인증 불가 상태(status=suspended)로 실제 저장됐는지 저장소로 확인
    const stored = await da.userById(ORG_A, created.id as string);
    expect(stored?.status).toBe("suspended");
  });

  it("PATCH replace {active:false} (path 없는 value 객체형)도 지원한다", async () => {
    const created = await createUser("off2@example.com", "idp-off2");
    const res = await req(`/Users/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "replace", value: { active: false } }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await da.userById(ORG_A, created.id as string))?.status).toBe(
      "suspended",
    );
  });

  it("PUT 로 전체 교체하면 displayName/active 가 반영된다", async () => {
    const created = await createUser("put@example.com", "idp-put");
    const res = await req(`/Users/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        userName: "put@example.com",
        displayName: "새 이름",
        active: false,
      }),
    });
    expect(res.status).toBe(200);
    const stored = await da.userById(ORG_A, created.id as string);
    expect(stored?.name).toBe("새 이름");
    expect(stored?.status).toBe("suspended");
  });

  it("DELETE 는 하드 삭제 대신 비활성화하고 204 를 반환한다", async () => {
    const created = await createUser("del@example.com", "idp-del");
    const res = await req(`/Users/${created.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const stored = await da.userById(ORG_A, created.id as string);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("suspended");
  });

  it("다른 org 의 토큰으로는 남의 user 를 읽을 수 없다(404, existence-leak 방지)", async () => {
    const created = await createUser("secret@example.com", "idp-secret");
    const res = await req(`/Users/${created.id}`, { token: TOKEN_B });
    expect(res.status).toBe(404);
    const ok = await req(`/Users/${created.id}`);
    expect(ok.status).toBe(200);
  });
});

describe("SCIM 2.0 — /Groups 프로비저닝", () => {
  it("members 를 포함해 생성하면 GET /Groups/{id} 로 멤버십이 읽힌다", async () => {
    const u1 = await createUser("g1@example.com", "idp-g1");
    const u2 = await createUser("g2@example.com", "idp-g2");
    const res = await req("/Groups", {
      method: "POST",
      body: JSON.stringify({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "엔지니어링",
        externalId: "idp-group-1",
        members: [{ value: u1.id }, { value: u2.id }],
      }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created.displayName).toBe("엔지니어링");

    const read = await req(`/Groups/${created.id}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      members: Array<{ value: string }>;
    };
    expect(body.members.map((m) => m.value).sort()).toEqual(
      [u1.id as string, u2.id as string].sort(),
    );
  });

  it("PATCH add/remove members 가 멤버십에 반영된다", async () => {
    const u1 = await createUser("m1@example.com", "idp-m1");
    const u2 = await createUser("m2@example.com", "idp-m2");
    const created = (await (
      await req("/Groups", {
        method: "POST",
        body: JSON.stringify({
          displayName: "팀",
          members: [{ value: u1.id }],
        }),
      })
    ).json()) as Record<string, unknown>;

    const added = await req(`/Groups/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "add", path: "members", value: [{ value: u2.id }] }],
      }),
    });
    expect(added.status).toBe(200);
    expect(
      (await da.groupById(ORG_A, created.id as string))?.memberUserIds.sort(),
    ).toEqual([u1.id as string, u2.id as string].sort());

    const removed = await req(`/Groups/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        Operations: [{ op: "remove", path: `members[value eq "${u1.id}"]` }],
      }),
    });
    expect(removed.status).toBe(200);
    expect(
      (await da.groupById(ORG_A, created.id as string))?.memberUserIds,
    ).toEqual([u2.id]);
  });

  it("displayName 중복 생성은 409 uniqueness", async () => {
    await req("/Groups", {
      method: "POST",
      body: JSON.stringify({ displayName: "중복" }),
    });
    const res = await req("/Groups", {
      method: "POST",
      body: JSON.stringify({ displayName: "중복" }),
    });
    expect(res.status).toBe(409);
  });

  it("DELETE /Groups/{id} 는 그룹을 제거하고 204", async () => {
    const created = (await (
      await req("/Groups", {
        method: "POST",
        body: JSON.stringify({ displayName: "삭제될그룹" }),
      })
    ).json()) as Record<string, unknown>;
    expect(
      (await req(`/Groups/${created.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect((await req(`/Groups/${created.id}`)).status).toBe(404);
  });

  it("다른 org 의 그룹은 404 (cross-org 격리)", async () => {
    const created = (await (
      await req("/Groups", {
        method: "POST",
        body: JSON.stringify({ displayName: "A조직그룹" }),
      })
    ).json()) as Record<string, unknown>;
    expect(
      (await req(`/Groups/${created.id}`, { token: TOKEN_B })).status,
    ).toBe(404);
  });
});

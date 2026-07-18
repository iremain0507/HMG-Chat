// routes/scim.ts — P22-T1-16(계약배치 C15): SCIM 2.0 user/group provisioning.
// IdP(Okta/Entra ID 등)가 서버-대-서버로 호출하는 프로비저닝 엔드포인트라 사용자 JWT
// (authMiddleware) 밖에 마운트하고, 전용 Bearer 토큰(scim_tokens, migration 0040)으로 인증한다.
// org 는 토큰에서만 파생 — body/path 로 받지 않아 cross-org 는 구조적으로 불가하며,
// 남의 org 리소스는 403 이 아니라 404 로 응답한다(existence-leak 방지, mcp-servers.ts 컨벤션).
//
// 사양: RFC 7643(schema) / RFC 7644(protocol). 리소스는 신규 테이블 없이 기존 identity 스키마에
// 매핑한다 — User=users(userName=email, active=status), Group=groups+group_members(0026).
// 삭제는 하드 삭제 대신 비활성(status=suspended) — IdP 의 deprovision 이 대화/감사 기록을
// 지우지 않도록(12-OPS-SECURITY 보존정책과 정합).
import { Hono } from "hono";
import { z } from "zod";
import {
  createPgScimDataAccess,
  type ScimDataAccess,
  type ScimGroupRecord,
  type ScimUserRecord,
} from "../db/scim-data-access.js";

const USER_SCHEMA_URN = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP_SCHEMA_URN = "urn:ietf:params:scim:schemas:core:2.0:Group";
const LIST_SCHEMA_URN = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR_SCHEMA_URN = "urn:ietf:params:scim:api:messages:2.0:Error";
const SPC_SCHEMA_URN =
  "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig";

const DEFAULT_COUNT = 100;
const MAX_COUNT = 500;

type ScimType =
  "invalidValue" | "invalidSyntax" | "uniqueness" | "mutability" | "noTarget";

/** RFC 7644 §3.12 Error 응답. status 는 문자열이어야 한다. */
function scimError(status: number, detail: string, scimType?: ScimType) {
  return {
    schemas: [ERROR_SCHEMA_URN],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

function userToResource(user: ScimUserRecord) {
  return {
    schemas: [USER_SCHEMA_URN],
    id: user.id,
    ...(user.externalId ? { externalId: user.externalId } : {}),
    userName: user.email,
    ...(user.name ? { displayName: user.name } : {}),
    emails: [{ value: user.email, primary: true }],
    active: user.status === "active",
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location: `/scim/v2/Users/${user.id}`,
    },
  };
}

function groupToResource(group: ScimGroupRecord) {
  return {
    schemas: [GROUP_SCHEMA_URN],
    id: group.id,
    ...(group.externalId ? { externalId: group.externalId } : {}),
    displayName: group.name,
    members: group.memberUserIds.map((id) => ({
      value: id,
      $ref: `/scim/v2/Users/${id}`,
      type: "User",
    })),
    meta: {
      resourceType: "Group",
      created: group.createdAt.toISOString(),
      lastModified: group.updatedAt.toISOString(),
      location: `/scim/v2/Groups/${group.id}`,
    },
  };
}

function listResponse(resources: unknown[], total: number, startIndex: number) {
  return {
    schemas: [LIST_SCHEMA_URN],
    totalResults: total,
    startIndex,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

// ─── filter 파싱 ───
// IdP 가 실제로 보내는 것은 사실상 `attr eq "value"` 하나뿐이라(Okta/Entra 프로비저닝),
// 전체 SCIM filter 문법 대신 이 형태만 지원하고 그 밖은 무시한다(400 대신 무필터 취급 금지 —
// 잘못된 필터로 전체 목록을 흘리지 않도록 인식 불가 필터는 400 invalidFilter 로 막는다).
const EQ_FILTER = /^\s*(\w+)\s+eq\s+"([^"]*)"\s*$/i;

function parseEqFilter(
  filter: string | undefined,
): { attr: string; value: string } | null | undefined {
  if (!filter) return undefined; // 필터 없음 = 전체
  const m = EQ_FILTER.exec(filter);
  const attr = m?.[1];
  const value = m?.[2];
  if (attr === undefined || value === undefined) return null; // 인식 불가
  return { attr: attr.toLowerCase(), value };
}

function parsePagination(c: {
  req: { query: (k: string) => string | undefined };
}) {
  const rawStart = Number(c.req.query("startIndex") ?? 1);
  const rawCount = Number(c.req.query("count") ?? DEFAULT_COUNT);
  const startIndex =
    Number.isFinite(rawStart) && rawStart >= 1 ? Math.floor(rawStart) : 1;
  const count =
    Number.isFinite(rawCount) && rawCount >= 0
      ? Math.min(Math.floor(rawCount), MAX_COUNT)
      : DEFAULT_COUNT;
  return { startIndex, count };
}

// ─── 요청 body 스키마 ───
const UserWriteSchema = z.object({
  userName: z.string().min(1).optional(),
  externalId: z.string().max(255).optional(),
  displayName: z.string().max(255).optional(),
  name: z
    .object({
      givenName: z.string().optional(),
      familyName: z.string().optional(),
      formatted: z.string().optional(),
    })
    .optional(),
  emails: z
    .array(z.object({ value: z.string(), primary: z.boolean().optional() }))
    .optional(),
  active: z.boolean().optional(),
});

const GroupWriteSchema = z.object({
  displayName: z.string().min(1).optional(),
  externalId: z.string().max(255).optional(),
  members: z.array(z.object({ value: z.string() })).optional(),
});

const PatchOpSchema = z.object({
  Operations: z
    .array(
      z.object({
        op: z.string(),
        path: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .min(1),
});

/** SCIM name 복합 속성 → users.name 단일 컬럼. displayName 이 있으면 그것을 우선한다. */
function resolveDisplayName(
  body: z.infer<typeof UserWriteSchema>,
): string | null | undefined {
  if (body.displayName !== undefined) return body.displayName || null;
  const n = body.name;
  if (!n) return undefined;
  const joined =
    n.formatted ?? [n.familyName, n.givenName].filter(Boolean).join("");
  return joined || null;
}

/** members[value eq "<id>"] 형태의 remove path 에서 대상 user id 를 뽑는다. */
const MEMBER_PATH = /^members(\[\s*value\s+eq\s+"([^"]+)"\s*\])?$/i;

export interface ScimRouteDeps {
  da?: ScimDataAccess;
}

export function createScimRoutes(deps: ScimRouteDeps = {}) {
  const da = deps.da ?? createPgScimDataAccess();
  const app = new Hono<{ Variables: { scimOrgId: string } }>();

  // 디스커버리(RFC 7644 §4)는 IdP 가 자격증명 설정 전에 조회하므로 인증 밖에 둔다.
  app.get("/ServiceProviderConfig", (c) =>
    c.json({
      schemas: [SPC_SCHEMA_URN],
      documentationUri: "https://datatracker.ietf.org/doc/html/rfc7644",
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: MAX_COUNT },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: "oauthbearertoken",
          name: "OAuth Bearer Token",
          description: "IdP 전용 SCIM Bearer 토큰(scim_tokens).",
          primary: true,
        },
      ],
      meta: {
        resourceType: "ServiceProviderConfig",
        location: "/scim/v2/ServiceProviderConfig",
      },
    }),
  );

  app.get("/ResourceTypes", (c) =>
    c.json(
      listResponse(
        [
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "User",
            name: "User",
            endpoint: "/Users",
            schema: USER_SCHEMA_URN,
            meta: { resourceType: "ResourceType" },
          },
          {
            schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
            id: "Group",
            name: "Group",
            endpoint: "/Groups",
            schema: GROUP_SCHEMA_URN,
            meta: { resourceType: "ResourceType" },
          },
        ],
        2,
        1,
      ),
    ),
  );

  app.get("/Schemas", (c) =>
    c.json(
      listResponse(
        [
          {
            id: USER_SCHEMA_URN,
            name: "User",
            description: "SCIM core User — users 테이블에 매핑",
            attributes: [
              {
                name: "userName",
                type: "string",
                required: true,
                uniqueness: "server",
              },
              { name: "displayName", type: "string", required: false },
              { name: "active", type: "boolean", required: false },
              {
                name: "emails",
                type: "complex",
                multiValued: true,
                required: false,
              },
            ],
            meta: { resourceType: "Schema" },
          },
          {
            id: GROUP_SCHEMA_URN,
            name: "Group",
            description: "SCIM core Group — groups/group_members 테이블에 매핑",
            attributes: [
              {
                name: "displayName",
                type: "string",
                required: true,
                uniqueness: "server",
              },
              {
                name: "members",
                type: "complex",
                multiValued: true,
                required: false,
              },
            ],
            meta: { resourceType: "Schema" },
          },
        ],
        2,
        1,
      ),
    ),
  );

  // ─── IdP Bearer 인증 (여기부터 전부 org-scoped) ───
  app.use("*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
    if (!token) {
      return c.json(scimError(401, "SCIM Bearer 토큰이 필요합니다."), 401, {
        "WWW-Authenticate": "Bearer",
      });
    }
    const resolved = await da.resolveToken(token);
    if (!resolved) {
      return c.json(scimError(401, "유효하지 않은 SCIM 토큰입니다."), 401);
    }
    c.set("scimOrgId", resolved.orgId);
    await next();
  });

  async function readBody(c: {
    req: { json: () => Promise<unknown> };
  }): Promise<unknown> {
    return c.req.json().catch(() => null);
  }

  // ─── /Users ───
  app.get("/Users", async (c) => {
    const orgId = c.get("scimOrgId");
    const filter = parseEqFilter(c.req.query("filter"));
    if (filter === null) {
      return c.json(
        scimError(
          400,
          '지원하지 않는 filter 입니다(attr eq "value" 만 지원).',
          "invalidValue",
        ),
        400,
      );
    }
    const { startIndex, count } = parsePagination(c);
    const byUserName =
      filter && (filter.attr === "username" || filter.attr === "email")
        ? filter.value
        : undefined;
    const byExternalId =
      filter && filter.attr === "externalid" ? filter.value : undefined;
    if (filter && !byUserName && !byExternalId) {
      return c.json(
        scimError(
          400,
          `filter 속성 ${filter.attr} 은 지원하지 않습니다.`,
          "invalidValue",
        ),
        400,
      );
    }
    const { items, total } = await da.listUsers(orgId, {
      startIndex,
      count,
      ...(byUserName !== undefined ? { email: byUserName } : {}),
      ...(byExternalId !== undefined ? { externalId: byExternalId } : {}),
    });
    return c.json(listResponse(items.map(userToResource), total, startIndex));
  });

  app.get("/Users/:id", async (c) => {
    const user = await da.userById(c.get("scimOrgId"), c.req.param("id"));
    if (!user) {
      return c.json(scimError(404, "user 를 찾을 수 없습니다."), 404);
    }
    return c.json(userToResource(user));
  });

  app.post("/Users", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = UserWriteSchema.safeParse(await readBody(c));
    if (!parsed.success || !parsed.data.userName) {
      return c.json(
        scimError(400, "userName 이 필요합니다.", "invalidValue"),
        400,
      );
    }
    const email =
      parsed.data.emails?.find((e) => e.primary)?.value ?? parsed.data.userName;
    // userName 은 org 안에서 유일(users.email UNIQUE) — 중복은 409 uniqueness(RFC 7644 §3.3).
    const existing = await da.userByEmail(orgId, email);
    if (existing) {
      return c.json(
        scimError(409, "이미 존재하는 userName 입니다.", "uniqueness"),
        409,
      );
    }
    const created = await da.createUser(orgId, {
      email,
      name: resolveDisplayName(parsed.data) ?? null,
      externalId: parsed.data.externalId ?? null,
      active: parsed.data.active ?? true,
    });
    return c.json(userToResource(created), 201);
  });

  app.put("/Users/:id", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = UserWriteSchema.safeParse(await readBody(c));
    if (!parsed.success) {
      return c.json(
        scimError(400, "잘못된 User 리소스입니다.", "invalidValue"),
        400,
      );
    }
    const displayName = resolveDisplayName(parsed.data);
    // exactOptionalPropertyTypes: 조건부 spread 는 `T | undefined` 로 넓어지므로
    // 명시 타입 patch 객체에 존재하는 키만 대입한다.
    const patch: Parameters<ScimDataAccess["updateUser"]>[2] = {};
    if (parsed.data.userName !== undefined) patch.email = parsed.data.userName;
    if (displayName !== undefined) patch.name = displayName;
    if (parsed.data.externalId !== undefined)
      patch.externalId = parsed.data.externalId;
    if (parsed.data.active !== undefined) patch.active = parsed.data.active;
    const updated = await da.updateUser(orgId, c.req.param("id"), patch);
    if (!updated) {
      return c.json(scimError(404, "user 를 찾을 수 없습니다."), 404);
    }
    return c.json(userToResource(updated));
  });

  app.patch("/Users/:id", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = PatchOpSchema.safeParse(await readBody(c));
    if (!parsed.success) {
      return c.json(
        scimError(400, "Operations 가 필요합니다.", "invalidSyntax"),
        400,
      );
    }
    // path 형(`{op, path:"active", value:false}`)과 value 객체형(`{op, value:{active:false}}`)
    // 둘 다 IdP 별로 실제 관측되므로 모두 받는다.
    const patch: {
      email?: string;
      name?: string | null;
      externalId?: string | null;
      active?: boolean;
    } = {};
    for (const op of parsed.data.Operations) {
      const kind = op.op.toLowerCase();
      if (kind !== "replace" && kind !== "add") continue;
      const entries: Array<[string, unknown]> = op.path
        ? [[op.path, op.value]]
        : Object.entries((op.value ?? {}) as Record<string, unknown>);
      for (const [rawAttr, value] of entries) {
        switch (rawAttr.toLowerCase()) {
          case "active":
            patch.active =
              value === true || value === "True" || value === "true";
            break;
          case "username":
            if (typeof value === "string") patch.email = value;
            break;
          case "displayname":
            patch.name = typeof value === "string" && value ? value : null;
            break;
          case "externalid":
            patch.externalId = typeof value === "string" ? value : null;
            break;
          default:
            break; // 미지원 속성은 무시(RFC 7644 는 서버 재량)
        }
      }
    }
    const updated = await da.updateUser(orgId, c.req.param("id"), patch);
    if (!updated) {
      return c.json(scimError(404, "user 를 찾을 수 없습니다."), 404);
    }
    return c.json(userToResource(updated));
  });

  // 하드 삭제 대신 비활성 — 대화/감사 기록 보존(12-OPS-SECURITY).
  app.delete("/Users/:id", async (c) => {
    const updated = await da.updateUser(c.get("scimOrgId"), c.req.param("id"), {
      active: false,
    });
    if (!updated) {
      return c.json(scimError(404, "user 를 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  // ─── /Groups ───
  app.get("/Groups", async (c) => {
    const orgId = c.get("scimOrgId");
    const filter = parseEqFilter(c.req.query("filter"));
    if (filter === null) {
      return c.json(
        scimError(400, "지원하지 않는 filter 입니다.", "invalidValue"),
        400,
      );
    }
    if (filter && filter.attr !== "displayname") {
      return c.json(
        scimError(
          400,
          `filter 속성 ${filter.attr} 은 지원하지 않습니다.`,
          "invalidValue",
        ),
        400,
      );
    }
    const { startIndex, count } = parsePagination(c);
    const groupQuery: Parameters<ScimDataAccess["listGroups"]>[1] = {
      startIndex,
      count,
    };
    if (filter) groupQuery.displayName = filter.value;
    const { items, total } = await da.listGroups(orgId, groupQuery);
    return c.json(listResponse(items.map(groupToResource), total, startIndex));
  });

  app.get("/Groups/:id", async (c) => {
    const group = await da.groupById(c.get("scimOrgId"), c.req.param("id"));
    if (!group) {
      return c.json(scimError(404, "group 을 찾을 수 없습니다."), 404);
    }
    return c.json(groupToResource(group));
  });

  app.post("/Groups", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = GroupWriteSchema.safeParse(await readBody(c));
    if (!parsed.success || !parsed.data.displayName) {
      return c.json(
        scimError(400, "displayName 이 필요합니다.", "invalidValue"),
        400,
      );
    }
    const existing = await da.groupByName(orgId, parsed.data.displayName);
    if (existing) {
      return c.json(
        scimError(409, "이미 존재하는 displayName 입니다.", "uniqueness"),
        409,
      );
    }
    const created = await da.createGroup(orgId, {
      name: parsed.data.displayName,
      externalId: parsed.data.externalId ?? null,
      memberUserIds: (parsed.data.members ?? []).map((m) => m.value),
    });
    return c.json(groupToResource(created), 201);
  });

  app.put("/Groups/:id", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = GroupWriteSchema.safeParse(await readBody(c));
    if (!parsed.success) {
      return c.json(
        scimError(400, "잘못된 Group 리소스입니다.", "invalidValue"),
        400,
      );
    }
    const patch: Parameters<ScimDataAccess["updateGroup"]>[2] = {};
    if (parsed.data.displayName !== undefined)
      patch.name = parsed.data.displayName;
    if (parsed.data.externalId !== undefined)
      patch.externalId = parsed.data.externalId;
    // PUT 은 전체 교체 — members 가 오면 그 집합으로 대체한다.
    if (parsed.data.members)
      patch.memberUserIds = parsed.data.members.map((m) => m.value);
    const updated = await da.updateGroup(orgId, c.req.param("id"), patch);
    if (!updated) {
      return c.json(scimError(404, "group 을 찾을 수 없습니다."), 404);
    }
    return c.json(groupToResource(updated));
  });

  app.patch("/Groups/:id", async (c) => {
    const orgId = c.get("scimOrgId");
    const parsed = PatchOpSchema.safeParse(await readBody(c));
    if (!parsed.success) {
      return c.json(
        scimError(400, "Operations 가 필요합니다.", "invalidSyntax"),
        400,
      );
    }
    const current = await da.groupById(orgId, c.req.param("id"));
    if (!current) {
      return c.json(scimError(404, "group 을 찾을 수 없습니다."), 404);
    }
    let members = [...current.memberUserIds];
    let name: string | undefined;
    let externalId: string | null | undefined;

    for (const op of parsed.data.Operations) {
      const kind = op.op.toLowerCase();
      const pathMatch = op.path ? MEMBER_PATH.exec(op.path) : null;
      const valueIds = Array.isArray(op.value)
        ? (op.value as Array<{ value?: unknown }>)
            .map((m) => m?.value)
            .filter((v): v is string => typeof v === "string")
        : [];

      if (pathMatch) {
        const targetFromPath = pathMatch[2];
        if (kind === "add") {
          members = [...new Set([...members, ...valueIds])];
        } else if (kind === "replace") {
          members = [...new Set(valueIds)];
        } else if (kind === "remove") {
          // members[value eq "<id>"] → 그 한 명, path 가 members 뿐이면 전체 비우기
          members = targetFromPath
            ? members.filter((id) => id !== targetFromPath)
            : valueIds.length > 0
              ? members.filter((id) => !valueIds.includes(id))
              : [];
        }
        continue;
      }

      if (kind === "replace" || kind === "add") {
        const entries: Array<[string, unknown]> = op.path
          ? [[op.path, op.value]]
          : Object.entries((op.value ?? {}) as Record<string, unknown>);
        for (const [attr, value] of entries) {
          switch (attr.toLowerCase()) {
            case "displayname":
              if (typeof value === "string" && value) name = value;
              break;
            case "externalid":
              externalId = typeof value === "string" ? value : null;
              break;
            case "members":
              if (Array.isArray(value)) {
                const ids = (value as Array<{ value?: unknown }>)
                  .map((m) => m?.value)
                  .filter((v): v is string => typeof v === "string");
                members =
                  kind === "add" ? [...new Set([...members, ...ids])] : ids;
              }
              break;
            default:
              break;
          }
        }
      }
    }

    const updated = await da.updateGroup(orgId, current.id, {
      ...(name !== undefined ? { name } : {}),
      ...(externalId !== undefined ? { externalId } : {}),
      memberUserIds: members,
    });
    if (!updated) {
      return c.json(scimError(404, "group 을 찾을 수 없습니다."), 404);
    }
    return c.json(groupToResource(updated));
  });

  app.delete("/Groups/:id", async (c) => {
    const removed = await da.deleteGroup(c.get("scimOrgId"), c.req.param("id"));
    if (!removed) {
      return c.json(scimError(404, "group 을 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  return app;
}

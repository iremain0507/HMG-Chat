// routes/admin-groups.ts — P19-T1-13: 그룹 CRUD + 멤버 추가/제거(admin 전용,
// migration 0026 groups/group_members 단일 출처). orgId 는 auth(JWT)에서만 파생 —
// body/query 로 받지 않아 cross-org 불가(admin-models.ts/admin.ts 와 동일 컨벤션).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createPgGroupDataAccess,
  type GroupDataAccess,
  type GroupWithMembers,
} from "../db/group-data-access.js";

const CreateGroupSchema = z.object({ name: z.string().min(1) });
const RenameGroupSchema = z.object({ name: z.string().min(1) });
const AddMemberSchema = z.object({ userId: z.string().min(1) });

function errorJson(code: string, message: string, details?: unknown) {
  return {
    error: {
      code,
      category: "http" as const,
      message,
      retryable: false,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

function isAdmin(role: string): boolean {
  return role === "admin" || role === "owner";
}

function toWire(group: GroupWithMembers) {
  return {
    id: group.id,
    name: group.name,
    memberUserIds: group.memberUserIds,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
}

export interface AdminGroupsRouteDeps {
  groups?: GroupDataAccess;
}

export function createAdminGroupsRoutes(
  deps: AdminGroupsRouteDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const groups = deps.groups ?? createPgGroupDataAccess();
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const list = await groups.list(auth.org);
    return c.json({
      data: list.map(toWire),
      meta: { requestId: randomUUID() },
    });
  });

  app.post("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = CreateGroupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson("INVALID_INPUT", "name 이 필요합니다.", parsed.error.issues),
        400,
      );
    }
    const created = await groups.create(auth.org, parsed.data.name);
    return c.json(
      {
        data: toWire({ ...created, memberUserIds: [] }),
        meta: { requestId: randomUUID() },
      },
      201,
    );
  });

  app.put("/:id", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = RenameGroupSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson("INVALID_INPUT", "name 이 필요합니다.", parsed.error.issues),
        400,
      );
    }
    const id = c.req.param("id");
    const renamed = await groups.rename(auth.org, id, parsed.data.name);
    if (!renamed) {
      return c.json(errorJson("NOT_FOUND", "그룹을 찾을 수 없습니다."), 404);
    }
    const list = await groups.list(auth.org);
    const withMembers = list.find((g) => g.id === renamed.id);
    return c.json({
      data: toWire(withMembers ?? { ...renamed, memberUserIds: [] }),
      meta: { requestId: randomUUID() },
    });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const id = c.req.param("id");
    const removed = await groups.remove(auth.org, id);
    if (!removed) {
      return c.json(errorJson("NOT_FOUND", "그룹을 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  app.post("/:id/members", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = AddMemberSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "userId 가 필요합니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    const groupId = c.req.param("id");
    const added = await groups.addMember(auth.org, groupId, parsed.data.userId);
    if (!added) {
      return c.json(
        errorJson("NOT_FOUND", "그룹 또는 사용자를 찾을 수 없습니다."),
        404,
      );
    }
    return c.body(null, 204);
  });

  app.delete("/:id/members/:userId", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const groupId = c.req.param("id");
    const userId = c.req.param("userId");
    const removed = await groups.removeMember(auth.org, groupId, userId);
    if (!removed) {
      return c.json(errorJson("NOT_FOUND", "멤버를 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  return app;
}

// routes/admin-grants.ts — P20-T1-04: resource_grants(migration 0027) 관리 라우트
// (grant 생성/조회/회수, admin 전용). orgId 는 auth(JWT)에서만 파생 — body/query 로 받지
// 않아 cross-org 불가(admin-groups.ts 와 동일 컨벤션). subjectId 가 org 밖이면
// resource-grants-data-access.ts#grant 가 false 를 반환해 404 로 거부한다.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createPgResourceGrantsDataAccess,
  type ResourceGrantsDataAccess,
} from "../db/resource-grants-data-access.js";
import type { AuditRecorder } from "../lib/audit-recorder.js";

const NOOP_AUDIT: AuditRecorder = { async record() {} };

const RESOURCE_TYPES = ["model", "knowledge", "tool", "prompt"] as const;
const SUBJECT_TYPES = ["user", "group"] as const;
const ACCESS_LEVELS = ["read", "write"] as const;

const GrantSchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.string().min(1),
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().min(1),
  access: z.enum(ACCESS_LEVELS),
});

const ResourceQuerySchema = z.object({
  resourceType: z.enum(RESOURCE_TYPES),
  resourceId: z.string().min(1),
});

// P22-T1-07: subject(group/user) 관점 조회 — 그룹 카드가 '이 그룹의 접근 권한' 목록을 얻는다.
const SubjectQuerySchema = z.object({
  subjectType: z.enum(SUBJECT_TYPES),
  subjectId: z.string().min(1),
});

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

export interface AdminGrantsRouteDeps {
  grants?: ResourceGrantsDataAccess;
  audit?: AuditRecorder;
}

export function createAdminGrantsRoutes(
  deps: AdminGrantsRouteDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const grants = deps.grants ?? createPgResourceGrantsDataAccess();
  const audit = deps.audit ?? NOOP_AUDIT;
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    const parsed = GrantSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "resourceType/resourceId/subjectType/subjectId/access 가 필요합니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    const { resourceType, resourceId, subjectType, subjectId, access } =
      parsed.data;
    const granted = await grants.grant(
      auth.org,
      resourceType,
      resourceId,
      subjectType,
      subjectId,
      access,
    );
    if (!granted) {
      return c.json(
        errorJson("NOT_FOUND", "subject 를 찾을 수 없습니다."),
        404,
      );
    }
    await audit.record({
      orgId: auth.org,
      actorUserId: auth.sub,
      action: "admin.grant.created",
      resourceType,
      resourceId,
      metadata: { subjectType, subjectId, access },
    });
    return c.json(
      {
        data: { resourceType, resourceId, subjectType, subjectId, access },
        meta: { requestId: randomUUID() },
      },
      201,
    );
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    // subject-scoped 조회(?subjectType=group&subjectId=…): 그룹/사용자가 보유한 grant 목록.
    // subjectType/subjectId 중 하나라도 있으면 subject 관점으로 처리한다(P22-T1-07).
    const subjectType = c.req.query("subjectType");
    const subjectId = c.req.query("subjectId");
    if (subjectType !== undefined || subjectId !== undefined) {
      const parsed = SubjectQuerySchema.safeParse({ subjectType, subjectId });
      if (!parsed.success) {
        return c.json(
          errorJson(
            "INVALID_INPUT",
            "subjectType/subjectId 쿼리가 필요합니다.",
            parsed.error.issues,
          ),
          400,
        );
      }
      const subjectList = await grants.grantsForSubject(
        auth.org,
        parsed.data.subjectType,
        parsed.data.subjectId,
      );
      return c.json({
        data: subjectList,
        meta: { requestId: randomUUID() },
      });
    }
    const parsed = ResourceQuerySchema.safeParse({
      resourceType: c.req.query("resourceType"),
      resourceId: c.req.query("resourceId"),
    });
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "resourceType/resourceId 쿼리가 필요합니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    const list = await grants.grantsForResource(
      auth.org,
      parsed.data.resourceType,
      parsed.data.resourceId,
    );
    return c.json({
      data: list,
      meta: { requestId: randomUUID() },
    });
  });

  app.delete("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const parsed = GrantSchema.safeParse({
      resourceType: c.req.query("resourceType"),
      resourceId: c.req.query("resourceId"),
      subjectType: c.req.query("subjectType"),
      subjectId: c.req.query("subjectId"),
      access: c.req.query("access"),
    });
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "resourceType/resourceId/subjectType/subjectId/access 쿼리가 필요합니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    const { resourceType, resourceId, subjectType, subjectId, access } =
      parsed.data;
    const revoked = await grants.revoke(
      auth.org,
      resourceType,
      resourceId,
      subjectType,
      subjectId,
      access,
    );
    if (!revoked) {
      return c.json(errorJson("NOT_FOUND", "grant 를 찾을 수 없습니다."), 404);
    }
    await audit.record({
      orgId: auth.org,
      actorUserId: auth.sub,
      action: "admin.grant.revoked",
      resourceType,
      resourceId,
      metadata: { subjectType, subjectId, access },
    });
    return c.body(null, 204);
  });

  return app;
}

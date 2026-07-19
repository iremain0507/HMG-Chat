// routes/admin-tools.ts — P22-T6-02: allowedTools 편집. organizations.allowed_tools
// (기존 컬럼, auth-data-access.ts organizations.update 가 이미 지원) 을 재사용 — 신규 테이블/컬럼
// 없음. orgId 는 auth(JWT)에서만 파생 — body/query 로 받지 않아 cross-org 불가.
// frozen Organization 타입 미수정: 여기서 쓰는 organizations dep 은 hand-rolled 최소 인터페이스.
// admin-models.ts(allowedModels) 패턴을 그대로 반영.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { Organization } from "@wchat/interfaces";
import type { AuditRecorder } from "../lib/audit-recorder.js";

const NOOP_AUDIT: AuditRecorder = { async record() {} };

const AllowedToolsSchema = z.object({
  allowedTools: z.array(z.string().min(1)),
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

export interface AdminToolsRouteDeps {
  organizations: {
    byId(id: string): Promise<Organization | null>;
    update(id: string, data: { allowedTools: string[] }): Promise<Organization>;
  };
  audit?: AuditRecorder;
}

export function createAdminToolsRoutes(
  deps: AdminToolsRouteDeps,
): Hono<{ Variables: AuthedVariables }> {
  const audit = deps.audit ?? NOOP_AUDIT;
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const org = await deps.organizations.byId(auth.org);
    return c.json({
      data: { allowedTools: org?.allowedTools ?? [] },
      meta: { requestId: randomUUID() },
    });
  });

  app.put("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const body = await c.req.json().catch(() => null);
    if (body === null || typeof body !== "object") {
      return c.json(
        errorJson("INVALID_INPUT", "요청 본문이 올바르지 않습니다."),
        400,
      );
    }
    const parsed = AllowedToolsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "allowedTools 가 올바르지 않습니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    const updated = await deps.organizations.update(auth.org, {
      allowedTools: parsed.data.allowedTools,
    });
    await audit.record({
      orgId: auth.org,
      actorUserId: auth.sub,
      action: "admin.tools.updated",
      resourceType: "org_settings",
      resourceId: auth.org,
      metadata: { allowedTools: updated.allowedTools },
    });
    return c.json({
      data: { allowedTools: updated.allowedTools },
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}

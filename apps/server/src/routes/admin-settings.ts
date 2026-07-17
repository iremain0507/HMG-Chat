// routes/admin-settings.ts — 16-API-CONTRACT.md 엔벨로프 + admin.ts 컨벤션.
//   GET/PUT /api/v1/admin/settings — org_settings(0017) 를 org_settings-schema.ts(LOCAL Zod) 로
//   검증/기본값 적용해 노출. orgId 는 auth(JWT)에서만 파생 — body/query 로 받지 않아 cross-org 불가.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { OrgSettingsDataAccess } from "../db/org-settings-data-access.js";
import type { SettingsService } from "../lib/settings-service.js";
import { OrgSettingsSchema } from "../lib/org-settings-schema.js";
import type { AuditRecorder } from "../lib/audit-recorder.js";

const NOOP_AUDIT: AuditRecorder = { async record() {} };

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

export function createAdminSettingsRoutes(deps: {
  da: OrgSettingsDataAccess;
  settingsService: SettingsService;
  audit?: AuditRecorder;
}): Hono<{ Variables: AuthedVariables }> {
  const audit = deps.audit ?? NOOP_AUDIT;
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", async (c) => {
    const auth = c.get("auth");
    if (!isAdmin(auth.role)) {
      return c.json(errorJson("FORBIDDEN", "admin 권한이 필요합니다."), 403);
    }
    const data = await deps.settingsService.resolve(auth.org);
    return c.json({ data, meta: { requestId: randomUUID() } });
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
    const parsed = OrgSettingsSchema.partial().safeParse(body);
    if (!parsed.success) {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "설정 값이 올바르지 않습니다.",
          parsed.error.issues,
        ),
        400,
      );
    }
    await deps.da.upsert(auth.org, parsed.data, auth.sub);
    deps.settingsService.invalidate(auth.org);
    const data = await deps.settingsService.resolve(auth.org);
    await audit.record({
      orgId: auth.org,
      actorUserId: auth.sub,
      action: "admin.settings.updated",
      resourceType: "org_settings",
      resourceId: auth.org,
      metadata: parsed.data,
    });
    return c.json({ data, meta: { requestId: randomUUID() } });
  });

  return app;
}

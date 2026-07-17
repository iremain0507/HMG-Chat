// routes/api-keys.ts — P19-T1-11: API 키 발급/목록/폐기(self-service, migration 0025 api_keys
// 단일 출처). 평문 키는 발급 응답에서 1회만 노출 — 목록은 keyPrefix 마스킹만 반환.
// Authorization: Bearer <key> 인증 소비는 middleware/auth-middleware.ts 가 담당.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createPgApiKeyDataAccess,
  type ApiKey,
  type ApiKeyDataAccess,
} from "../db/api-key-data-access.js";
import type { SettingsService } from "../lib/settings-service.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toWire(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
    revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
    createdAt: key.createdAt.toISOString(),
  };
}

interface CreateApiKeyBody {
  name?: string;
  scopes?: unknown;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export interface ApiKeyRoutesDeps {
  apiKeys?: ApiKeyDataAccess;
  settings?: SettingsService;
}

export function createApiKeyRoutes(
  deps: ApiKeyRoutesDeps = {},
): Hono<{ Variables: AuthedVariables }> {
  const apiKeys = deps.apiKeys ?? createPgApiKeyDataAccess();
  const settings = deps.settings;
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const auth = c.get("auth");
    // P20-T1-12: 전역 마스터 토글(org_settings.enableApiKeys) — off 면 신규 발급 거부.
    // settings 미주입(테스트 등)은 항상 허용(기존 동작 보존).
    if (settings) {
      const resolved = await settings.resolve(auth.org);
      if (!resolved.enableApiKeys) {
        return c.json(
          errorJson(
            "FORBIDDEN",
            "이 조직은 API 키 발급이 비활성화되어 있습니다.",
          ),
          403,
        );
      }
    }
    const body = await c.req
      .json<CreateApiKeyBody>()
      .catch(() => ({}) as CreateApiKeyBody);
    const name = body.name?.trim();
    if (!name) {
      return c.json(errorJson("INVALID_INPUT", "name 이 필요합니다."), 400);
    }
    if (body.scopes !== undefined && !isStringArray(body.scopes)) {
      return c.json(
        errorJson("INVALID_INPUT", "scopes 는 문자열 배열이어야 합니다."),
        400,
      );
    }
    const scopes = isStringArray(body.scopes) ? body.scopes : [];
    const { key, rawKey } = await apiKeys.create(auth.org, auth.sub, {
      name,
      scopes,
    });
    return c.json(
      {
        data: { ...toWire(key), key: rawKey },
        meta: { requestId: randomUUID() },
      },
      201,
    );
  });

  app.get("/", async (c) => {
    const auth = c.get("auth");
    const list = await apiKeys.listForOwner(auth.org, auth.sub);
    return c.json({
      data: list.map(toWire),
      meta: { requestId: randomUUID() },
    });
  });

  app.delete("/:id", async (c) => {
    const auth = c.get("auth");
    const id = c.req.param("id");
    const revoked = await apiKeys.revokeForOwner(auth.org, auth.sub, id);
    if (!revoked) {
      return c.json(errorJson("NOT_FOUND", "API 키를 찾을 수 없습니다."), 404);
    }
    return c.body(null, 204);
  });

  return app;
}

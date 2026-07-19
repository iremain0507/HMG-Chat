// middleware/auth-middleware.ts — sessions/messages 라우트 보호. 16-API-CONTRACT § 인증
// 쿠키(atCookie, routes/auth.ts 와 동일 이름 규칙) 검증, 미인증/유효하지 않으면 401.
// P19-T1-11 — Authorization: Bearer <api-key> 도 쿠키 JWT 와 동등하게 수용(api_keys migration
// 0025). 쿠키가 없을 때만 Bearer 를 확인 — 기존 쿠키 기반 라우트는 DB 조회 없이 그대로 동작(L2).
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verifyAccessToken, type AccessTokenPayload } from "./jwt.js";
import {
  createPgApiKeyDataAccess,
  type ApiKeyDataAccess,
} from "../db/api-key-data-access.js";
import { createLogger } from "../lib/logger.js";

export interface AuthedVariables {
  auth: AccessTokenPayload;
}

function cookieName(): string {
  return `${process.env.PROJECT_SLUG ?? "wchat"}_at`;
}

function unauthorized(message: string) {
  return {
    error: {
      code: "UNAUTHENTICATED",
      category: "auth" as const,
      message,
      retryable: false,
    },
  };
}

function forbidden(message: string) {
  return {
    error: {
      code: "FORBIDDEN",
      category: "auth" as const,
      message,
      retryable: false,
    },
  };
}

// P20-T1-12 — scope 형식은 "<resource>:<read|write>". 빈 scopes(기존 키)는 하위호환 전권.
// sessions/messages 는 "chat" 리소스로 통합(같은 앱 마운트, 채팅 도메인 개념).
const RESOURCE_ALIASES: Record<string, string> = {
  sessions: "chat",
  messages: "chat",
};

function requiredScopeFor(
  method: string,
  pathname: string,
): string | undefined {
  const match = /^\/api\/v1\/([^/]+)/.exec(pathname);
  const segment = match?.[1];
  if (!segment) return undefined;
  const resource = RESOURCE_ALIASES[segment] ?? segment;
  const action = method === "GET" || method === "HEAD" ? "read" : "write";
  return `${resource}:${action}`;
}

function bearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue?.startsWith("Bearer ")) return undefined;
  const token = headerValue.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

let apiKeys: ApiKeyDataAccess | undefined;
function apiKeyDataAccess(): ApiKeyDataAccess {
  apiKeys ??= createPgApiKeyDataAccess();
  return apiKeys;
}

const logger = createLogger();

export const authMiddleware: MiddlewareHandler<{
  Variables: AuthedVariables;
}> = async (c, next) => {
  const token = getCookie(c, cookieName());
  if (token) {
    try {
      c.set("auth", verifyAccessToken(token));
    } catch {
      return c.json(unauthorized("토큰이 유효하지 않습니다."), 401);
    }
    await next();
    return;
  }

  const rawKey = bearerToken(c.req.header("Authorization"));
  if (!rawKey) {
    return c.json(unauthorized("로그인이 필요합니다."), 401);
  }
  const found = await apiKeyDataAccess().findActiveByRawKey(rawKey);
  if (!found) {
    return c.json(unauthorized("API 키가 유효하지 않습니다."), 401);
  }
  if (found.scopes.length > 0) {
    const required = requiredScopeFor(c.req.method, c.req.path);
    if (!required || !found.scopes.includes(required)) {
      return c.json(
        forbidden("이 API 키의 권한 범위(scope)를 벗어난 요청입니다."),
        403,
      );
    }
  }
  const now = Math.floor(Date.now() / 1000);
  c.set("auth", {
    iss: process.env.PROJECT_SLUG ?? "wchat",
    sub: found.userId,
    org: found.orgId,
    role: found.role,
    scope: "access",
    iat: now,
    exp: now + 900,
    jti: rawKey.slice(0, 16),
  });
  await apiKeyDataAccess()
    .touchLastUsed(found.id)
    .catch((err: unknown) => {
      logger.warn({
        category: "auth",
        msg: "api-key-touch-last-used-failed",
        context: { error: err instanceof Error ? err.message : String(err) },
      });
    });
  await next();
};

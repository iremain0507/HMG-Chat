// middleware/auth-middleware.ts — sessions/messages 라우트 보호. 16-API-CONTRACT § 인증
// 쿠키(atCookie, routes/auth.ts 와 동일 이름 규칙) 검증, 미인증/유효하지 않으면 401.
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { verifyAccessToken, type AccessTokenPayload } from "./jwt.js";

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

export const authMiddleware: MiddlewareHandler<{
  Variables: AuthedVariables;
}> = async (c, next) => {
  const token = getCookie(c, cookieName());
  if (!token) {
    return c.json(unauthorized("로그인이 필요합니다."), 401);
  }
  try {
    const payload = verifyAccessToken(token);
    c.set("auth", payload);
  } catch {
    return c.json(unauthorized("토큰이 유효하지 않습니다."), 401);
  }
  await next();
};

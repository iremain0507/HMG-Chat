// routes/conversation-share.ts — P20-T1-08: 대화 스냅샷 공유 링크(불변).
// 인증 라우트(POST 발급/DELETE revoke, sessionsApp 에 동봉 마운트 — routes/artifact-shares.ts 와
// 동일 패턴)는 세션 소유자만 호출 가능(existence-leak 방지 위해 미소유 세션은 404).
// 공개 무인증 조회(routes/public-share.ts 와 동일 패턴, authMiddleware 밖 별도 prefix 마운트)는
// createPublicConversationShareRoutes 로 분리.
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createConversationShareService,
  ConversationShareServiceError,
  type ConversationSharesDataAccess,
  type ConversationShareMessagesPort,
  type ConversationShareSessionsPort,
} from "../db/conversation-share-service.js";

function errorJson(
  code: string,
  message: string,
  reason?: "expired" | "revoked",
) {
  return {
    error: {
      code,
      category: "http" as const,
      message,
      retryable: false,
      ...(reason ? { reason } : {}),
    },
  };
}

export function createConversationShareRoutes(deps: {
  da: ConversationSharesDataAccess;
  sessions: ConversationShareSessionsPort;
  messages: ConversationShareMessagesPort;
  appOrigin: string;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const shareService = createConversationShareService(deps);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  app.post("/:id/share-snapshot", async (c) => {
    const actor = actorOf(c);
    try {
      const share = await shareService.issueShare(actor, c.req.param("id"));
      return c.json(
        {
          data: {
            token: share.token,
            url: `${deps.appOrigin}/share/conversations/${share.token}`,
            expiresAt: share.expiresAt ? share.expiresAt.toISOString() : null,
          },
          meta: { requestId: crypto.randomUUID() },
        },
        201,
      );
    } catch (err) {
      if (err instanceof ConversationShareServiceError) {
        return c.json(errorJson(err.code, err.message), 404);
      }
      throw err;
    }
  });

  app.delete("/:id/share-snapshot/:token", async (c) => {
    const actor = actorOf(c);
    const found = await deps.da.conversationShares.byToken(
      c.req.param("token"),
    );
    if (!found || found.sessionId !== c.req.param("id")) {
      return c.json(errorJson("NOT_FOUND", "share 를 찾을 수 없습니다."), 404);
    }
    try {
      await shareService.revokeShare(actor, found.id);
    } catch (err) {
      if (err instanceof ConversationShareServiceError) {
        return c.json(errorJson(err.code, err.message), 404);
      }
      throw err;
    }
    return c.body(null, 204);
  });

  return app;
}

// 공개(무인증) 조회 — 16-API-CONTRACT § 8 GET /api/v1/share/:token(artifact) 와 동일 사유로
// authMiddleware 밖에 별도 prefix(/api/v1/conversation-shares)로 마운트한다. artifact 공개 조회와
// 같은 prefix(/api/v1/share)를 쓰면 "미마운트 404" 와 "유효하지 않은 토큰 → 404" 를 라우트
// 매칭만으로 구분할 수 없어(routes-mounted.test.ts 주석 참고) 별도 prefix 로 모호성을 없앤다.
export function createPublicConversationShareRoutes(deps: {
  da: ConversationSharesDataAccess;
}): Hono {
  const app = new Hono();
  const shareService = createConversationShareService({
    ...deps,
    // public 조회는 발급이 필요 없어 sessions/messages 포트를 쓰지 않는다 — resolvePublicShare
    // 만 호출되므로 미사용 포트는 호출 시 에러가 나도 무방하지만, 타입 충족을 위해 no-op 스텁을 둔다.
    sessions: { byId: async () => null },
    messages: { list: async () => ({ items: [] }) },
  });

  app.get("/:token", async (c) => {
    try {
      const share = await shareService.resolvePublicShare(c.req.param("token"));
      return c.json({
        data: {
          token: share.token,
          sessionId: share.snapshot.sessionId,
          title: share.snapshot.title,
          capturedAt: share.snapshot.capturedAt,
          messages: share.snapshot.messages,
          revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
        },
        meta: { requestId: crypto.randomUUID() },
      });
    } catch (err) {
      if (err instanceof ConversationShareServiceError) {
        return c.json(
          errorJson(err.code, err.message, err.reason),
          err.code === "GONE" ? 410 : 404,
        );
      }
      throw err;
    }
  });

  return app;
}

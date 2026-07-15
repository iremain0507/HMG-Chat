// routes/artifact-shares.ts — 16-API-CONTRACT.md § 8 Artifact Shares 단일 출처.
// 인증 라우트(artifacts 라우터에 동봉 마운트) — POST/GET/DELETE 모두 artifact 소유자만 호출 가능
// (artifact-service.getArtifactForActor 로 존재+소유 확인 후 artifact-share-service 위임,
// existence-leak 방지 위해 미소유 artifact 는 404). public 무인증 조회는 routes/public-share.ts(P6-T4-01).
import { Hono } from "hono";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../db/artifact-service.js";
import {
  createArtifactShareService,
  ArtifactShareServiceError,
  type ArtifactShareDataAccess,
} from "../db/artifact-share-service.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createArtifactShareRoutes(deps: {
  da: ArtifactDataAccess & ArtifactShareDataAccess;
  appOrigin: string;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const artifactService = createArtifactService(deps.da);
  const shareService = createArtifactShareService(deps.da);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    return { userId: c.get("auth").sub };
  }

  app.post("/:id/share", async (c) => {
    const actor = actorOf(c);
    const artifact = await artifactService.getArtifactForActor(
      actor,
      c.req.param("id"),
    );
    if (!artifact) {
      return c.json(
        errorJson("NOT_FOUND", "artifact 를 찾을 수 없습니다."),
        404,
      );
    }
    const body = await c.req
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    const ttlDays = typeof body.ttlDays === "number" ? body.ttlDays : undefined;
    try {
      const share =
        ttlDays === undefined
          ? await shareService.issueShare(actor, artifact.id)
          : await shareService.issueShare(actor, artifact.id, ttlDays);
      return c.json(
        {
          data: {
            token: share.token,
            url: `${deps.appOrigin}/share/${share.token}`,
            expiresAt: share.expiresAt.toISOString(),
          },
          meta: { requestId: crypto.randomUUID() },
        },
        201,
      );
    } catch (err) {
      if (err instanceof ArtifactShareServiceError) {
        return c.json(errorJson(err.code, err.message), 400);
      }
      throw err;
    }
  });

  app.get("/:id/shares", async (c) => {
    const actor = actorOf(c);
    const artifact = await artifactService.getArtifactForActor(
      actor,
      c.req.param("id"),
    );
    if (!artifact) {
      return c.json(
        errorJson("NOT_FOUND", "artifact 를 찾을 수 없습니다."),
        404,
      );
    }
    const { items } = await deps.da.artifactShares.list({
      artifactId: artifact.id,
    });
    return c.json({
      data: items.map((s) => ({
        id: s.id,
        token: s.token,
        expiresAt: s.expiresAt.toISOString(),
        revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
        viewCount: s.viewCount,
      })),
      meta: { requestId: crypto.randomUUID() },
    });
  });

  app.delete("/:id/share/:token", async (c) => {
    const actor = actorOf(c);
    const artifact = await artifactService.getArtifactForActor(
      actor,
      c.req.param("id"),
    );
    if (!artifact) {
      return c.json(
        errorJson("NOT_FOUND", "artifact 를 찾을 수 없습니다."),
        404,
      );
    }
    const found = await deps.da.artifactShares.byToken(c.req.param("token"));
    if (!found || found.artifactId !== artifact.id) {
      return c.json(errorJson("NOT_FOUND", "share 를 찾을 수 없습니다."), 404);
    }
    try {
      await shareService.revokeShare(actor, found.id);
    } catch (err) {
      if (err instanceof ArtifactShareServiceError) {
        return c.json(errorJson(err.code, err.message), 404);
      }
      throw err;
    }
    return c.body(null, 204);
  });

  return app;
}

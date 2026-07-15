// routes/public-share.ts — 16-API-CONTRACT.md § 8 GET /api/v1/share/:token(/content) 단일 출처.
// authMiddleware 전에 마운트(인증 우회) — ADR-22: S3 를 직접 노출하는 대신 서버가 inline stream
// relay(ArtifactStore.getInline). 존재하지 않는 토큰 404, 만료/revoke 는 410 GONE.
import { Hono } from "hono";
import type { ArtifactRecord, ArtifactStore } from "@wchat/interfaces";
import type { ArtifactDataAccess } from "../db/artifact-service.js";
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

export function createPublicShareRoutes(deps: {
  da: ArtifactDataAccess & ArtifactShareDataAccess;
  inlineStore: ArtifactStore;
  s3Store: ArtifactStore;
}): Hono {
  const app = new Hono();
  const shareService = createArtifactShareService(deps.da);

  function storeFor(artifact: ArtifactRecord): ArtifactStore {
    return artifact.storageKind === "s3" ? deps.s3Store : deps.inlineStore;
  }

  async function resolve(token: string) {
    const share = await shareService.resolvePublicShare(token);
    const artifact = await deps.da.artifacts.byId(share.artifactId);
    if (!artifact) {
      throw new ArtifactShareServiceError(
        "NOT_FOUND",
        "artifact 를 찾을 수 없습니다.",
      );
    }
    return { share, artifact };
  }

  app.get("/:token", async (c) => {
    try {
      const { share, artifact } = await resolve(c.req.param("token"));
      return c.json({
        data: {
          token: share.token,
          artifactId: artifact.id,
          filename: artifact.filename,
          type: artifact.type,
          sizeBytes: artifact.sizeBytes,
          mimeType: artifact.mimeType,
          expiresAt: share.expiresAt.toISOString(),
          viewCount: share.viewCount,
          revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
        },
        meta: { requestId: crypto.randomUUID() },
      });
    } catch (err) {
      if (err instanceof ArtifactShareServiceError) {
        return c.json(
          errorJson(err.code, err.message),
          err.code === "GONE" ? 410 : 404,
        );
      }
      throw err;
    }
  });

  app.get("/:token/content", async (c) => {
    try {
      const { share, artifact } = await resolve(c.req.param("token"));
      const { content, mimeType } = await storeFor(artifact).getInline(
        artifact.id,
      );
      await shareService.recordView(share.token);
      return c.body(content, 200, { "content-type": mimeType });
    } catch (err) {
      if (err instanceof ArtifactShareServiceError) {
        return c.json(
          errorJson(err.code, err.message),
          err.code === "GONE" ? 410 : 404,
        );
      }
      throw err;
    }
  });

  return app;
}

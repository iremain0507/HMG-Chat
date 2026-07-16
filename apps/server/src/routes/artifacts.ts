// routes/artifacts.ts — 16-API-CONTRACT.md § 7 Artifacts 단일 출처.
// GET /:id — storageKind 별 downloadUrl 분기(inline=null, s3=서명 URL).
// GET /:id/content — 바이트 직접 응답. inline 은 인증만으로 바로 stream, s3 는 LOCAL_ONLY 라
// 실 S3 presigned URL 이 없으므로 HMAC-SHA256 서명 + 60초 만료 쿼리 토큰으로 동일 계약
// (§ 7 "presigned URL 60s, token 만료 시 차단")을 에뮬레이션한다 — 배포 시 실 S3 presigned 로 교체.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { ArtifactRecord, ArtifactStore } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../db/artifact-service.js";

const DOWNLOAD_TOKEN_TTL_MS = 60_000; // 16-API-CONTRACT § 7 — presigned URL 60초.

function sign(secret: string, artifactId: string, exp: number): string {
  return createHmac("sha256", secret)
    .update(`${artifactId}.${exp}`)
    .digest("hex");
}

function verify(
  secret: string,
  artifactId: string,
  exp: number,
  sig: string,
): boolean {
  const expected = sign(secret, artifactId, exp);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(artifact: ArtifactRecord, downloadUrl: string | null) {
  return {
    id: artifact.id,
    sessionId: artifact.sessionId,
    type: artifact.type,
    filename: artifact.filename,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt.toISOString(),
    storageKind: artifact.storageKind,
    downloadUrl,
  };
}

export function createArtifactRoutes(deps: {
  da: ArtifactDataAccess;
  inlineStore: ArtifactStore;
  s3Store: ArtifactStore;
  downloadSecret: string;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const service = createArtifactService(deps.da);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    return { userId: c.get("auth").sub };
  }

  function storeFor(artifact: ArtifactRecord): ArtifactStore {
    return artifact.storageKind === "s3" ? deps.s3Store : deps.inlineStore;
  }

  app.get("/:id", async (c) => {
    const found = await service.getArtifactForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(
        errorJson("NOT_FOUND", "artifact 를 찾을 수 없습니다."),
        404,
      );
    }
    let downloadUrl: string | null = null;
    if (found.storageKind === "s3") {
      const exp = Date.now() + DOWNLOAD_TOKEN_TTL_MS;
      const sig = sign(deps.downloadSecret, found.id, exp);
      downloadUrl = `/${found.id}/content?exp=${exp}&sig=${sig}`;
    }
    return c.json({
      data: toDto(found, downloadUrl),
      meta: { requestId: crypto.randomUUID() },
    });
  });

  app.get("/:id/content", async (c) => {
    const found = await service.getArtifactForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(
        errorJson("NOT_FOUND", "artifact 를 찾을 수 없습니다."),
        404,
      );
    }

    if (found.storageKind === "s3") {
      const exp = Number(c.req.query("exp"));
      const sig = c.req.query("sig");
      if (!exp || !sig) {
        return c.json(
          errorJson("INVALID_INPUT", "다운로드 토큰(exp, sig)이 필요합니다."),
          400,
        );
      }
      if (Date.now() > exp) {
        return c.json(
          errorJson("TOKEN_EXPIRED", "다운로드 링크가 만료되었습니다."),
          403,
        );
      }
      if (!verify(deps.downloadSecret, found.id, exp, sig)) {
        return c.json(
          errorJson("INVALID_TOKEN", "다운로드 토큰이 유효하지 않습니다."),
          403,
        );
      }
    }

    const { content, mimeType } = await storeFor(found).getInline(found.id);
    // HTTP 헤더 값은 Latin1(ByteString) 만 허용 — 비ASCII(한글 등) 파일명을 그대로 넣으면
    //   "Cannot convert to ByteString" 로 500. RFC 6266: ASCII fallback(filename) +
    //   UTF-8 percent-encoded(filename*) 를 함께 제공한다.
    const asciiName =
      found.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "") ||
      "download";
    return c.body(content, 200, {
      "content-type": mimeType,
      "content-disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(
        found.filename,
      )}`,
    });
  });

  return app;
}

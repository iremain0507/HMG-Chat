// routes/uploads.ts — 16-API-CONTRACT.md § 6 Uploads 단일 출처.
// upload-service.ts 가 sha256 dedup/소유자 격리를 강제하므로, 여기선 HTTP 계층
// (multipart 파싱/상태코드 매핑)만 담당한다. NOT_FOUND 는 다른 유저의 업로드 존재 여부를
// 노출하지 않기 위해 404 로 매핑한다(routes/projects.ts 와 동일 existence-leak 방지 패턴).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { UploadRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  UploadServiceError,
  createUploadService,
  type UploadDataAccess,
  type UploadIndexingDeps,
} from "../db/upload-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import type { SettingsService } from "../lib/settings-service.js";
import type { ChunkOptions } from "../knowledge/chunker.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(upload: UploadRecord) {
  return {
    id: upload.id,
    filename: upload.filename,
    mimeType: upload.mimeType,
    sizeBytes: upload.sizeBytes,
    expiresAt: upload.expiresAt.toISOString(),
    createdAt: upload.createdAt.toISOString(),
  };
}

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx + 1).toLowerCase();
}

export function createUploadRoutes(deps: {
  da: UploadDataAccess;
  objectStore: ObjectStore;
  indexing?: UploadIndexingDeps;
  settings?: SettingsService;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const service = createUploadService(deps.da, deps.objectStore, deps.indexing);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    return { userId: c.get("auth").sub };
  }

  app.post("/", async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    if (!file || !(file instanceof File)) {
      return c.json(errorJson("INVALID_INPUT", "file 이 필요합니다."), 400);
    }
    const sessionId =
      typeof form?.sessionId === "string" ? form.sessionId : null;
    const data = Buffer.from(await file.arrayBuffer());
    const actor = actorOf(c);

    // P22-T3-03: org-scoped RAG 청크 설정. actor 에 orgId 가 없어 org 유래 chunkOptions 는
    // 반드시 라우트에서 유래해야 한다. size/count 강제와 같은 resolved 객체를 재사용(2차 resolve 없음).
    let chunkOptions: ChunkOptions | undefined;

    // P20-T1-17: org_settings 화이트리스트/size/count 강제(설정 미주입 시 기존 동작 보존).
    if (deps.settings) {
      const auth = c.get("auth");
      const resolved = await deps.settings.resolve(auth.org);
      chunkOptions = {
        chunkSizeTokens: resolved.ragChunkSizeTokens,
        overlapTokens: resolved.ragChunkOverlapTokens,
      };
      const ext = extensionOf(file.name);
      if (
        resolved.allowedUploadExtensions.length > 0 &&
        !resolved.allowedUploadExtensions.includes(ext)
      ) {
        return c.json(
          errorJson(
            "UNSUPPORTED_MEDIA_TYPE",
            `허용되지 않은 파일 확장자입니다: .${ext || "(없음)"}`,
          ),
          400,
        );
      }
      const maxBytes = resolved.maxUploadSizeMb * 1024 * 1024;
      if (data.byteLength > maxBytes) {
        return c.json(
          errorJson(
            "PAYLOAD_TOO_LARGE",
            `업로드 용량 한도(${resolved.maxUploadSizeMb}MB)를 초과했습니다.`,
          ),
          400,
        );
      }
      const existing = await deps.da.uploads.list(
        { userId: actor.userId },
        { limit: resolved.maxUploadCount + 1 },
      );
      if (existing.items.length >= resolved.maxUploadCount) {
        return c.json(
          errorJson(
            "QUOTA_EXCEEDED",
            `업로드 개수 한도(${resolved.maxUploadCount}개)를 초과했습니다.`,
          ),
          400,
        );
      }
    }

    const upload = await service.createUpload(actor, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      data,
      sessionId,
      chunkOptions,
    });
    return c.json(
      { data: toDto(upload), meta: { requestId: randomUUID() } },
      201,
    );
  });

  app.get("/:id", async (c) => {
    const found = await service.getUploadForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "업로드를 찾을 수 없습니다."), 404);
    }
    return c.json({
      data: {
        ...toDto(found),
        downloadUrl: `/api/v1/uploads/${found.id}/download`,
      },
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id/download", async (c) => {
    const found = await service.getUploadForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "업로드를 찾을 수 없습니다."), 404);
    }
    const bytes = await deps.objectStore.get(found.s3Key);
    return c.body(bytes, 200, {
      "content-type": found.mimeType,
      "content-disposition": `attachment; filename="${found.filename}"`,
    });
  });

  app.delete("/:id", async (c) => {
    try {
      await service.deleteUpload(actorOf(c), c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      if (err instanceof UploadServiceError) {
        return c.json(errorJson(err.code, err.message), 404);
      }
      throw err;
    }
  });

  return app;
}

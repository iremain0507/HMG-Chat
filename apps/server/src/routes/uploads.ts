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

export function createUploadRoutes(deps: {
  da: UploadDataAccess;
  objectStore: ObjectStore;
  indexing?: UploadIndexingDeps;
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
    const upload = await service.createUpload(actorOf(c), {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      data,
      sessionId,
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

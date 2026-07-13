// routes/documents.ts — 16-API-CONTRACT.md § 5 Project Documents 단일 출처(목록/조회/삭제 범위).
// db/document-service.ts 가 project 읽기/쓰기 권한 매트릭스를 강제하므로, 여기선 HTTP 계층
// (쿼리 파싱/상태코드 매핑)만 담당한다. NOT_FOUND/FORBIDDEN 모두 404 로 매핑해
// existence-leak 을 방지한다 (routes/projects.ts, routes/uploads.ts 와 동일 패턴).
// 생성(POST, multipart 업로드 → parser-pipeline 큐잉)은 knowledge/parser-pipeline(P4-T3-02+)
// 의존이라 이 태스크 범위 밖 — feature_list.json P4-T3-07 desc 가 CRUD 를 목록/조회/삭제로 명시.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ProjectDocumentRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  DocumentServiceError,
  createDocumentService,
  type DocumentDataAccess,
} from "../db/document-service.js";
import type { ObjectStore } from "../lib/object-store.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function toDto(doc: ProjectDocumentRecord) {
  return {
    id: doc.id,
    projectId: doc.projectId,
    filename: doc.filename,
    contentHash: doc.contentHash,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    indexStatus: doc.indexStatus,
    chunkCount: doc.chunkCount,
    indexedAt: doc.indexedAt ? doc.indexedAt.toISOString() : null,
    failureReason: doc.failureReason,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function createDocumentRoutes(deps: {
  da: DocumentDataAccess;
  objectStore: ObjectStore;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const service = createDocumentService(deps.da, deps.objectStore);

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  function handleServiceError(err: unknown): {
    body: ReturnType<typeof errorJson>;
    status: 404;
  } {
    if (err instanceof DocumentServiceError) {
      // FORBIDDEN 도 404 로 매핑 — existence-leak 방지 (다른 org/비멤버에게 문서 존재 자체를 숨김).
      return { body: errorJson("NOT_FOUND", err.message), status: 404 };
    }
    throw err;
  }

  app.get("/", async (c) => {
    const projectId = c.req.query("projectId");
    if (!projectId) {
      return c.json(
        errorJson("INVALID_INPUT", "projectId 가 필요합니다."),
        400,
      );
    }
    const contentHash = c.req.query("contentHash");
    try {
      const docs = await service.listDocumentsForActor(
        actorOf(c),
        projectId,
        contentHash ? { contentHash } : undefined,
      );
      return c.json({
        data: docs.map(toDto),
        meta: { requestId: randomUUID() },
      });
    } catch (err) {
      const { body, status } = handleServiceError(err);
      return c.json(body, status);
    }
  });

  app.get("/:id", async (c) => {
    const found = await service.getDocumentForActor(
      actorOf(c),
      c.req.param("id"),
    );
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "문서를 찾을 수 없습니다."), 404);
    }
    return c.json({ data: toDto(found), meta: { requestId: randomUUID() } });
  });

  app.delete("/:id", async (c) => {
    try {
      await service.deleteDocument(actorOf(c), c.req.param("id"));
      return c.body(null, 204);
    } catch (err) {
      const { body, status } = handleServiceError(err);
      return c.json(body, status);
    }
  });

  return app;
}

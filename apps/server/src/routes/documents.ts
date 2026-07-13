// routes/documents.ts — 16-API-CONTRACT.md § 5 Project Documents 단일 출처.
// db/document-service.ts 가 project 읽기/쓰기 권한 매트릭스를 강제하므로, 여기선 HTTP 계층
// (쿼리/멀티파트 파싱/상태코드 매핑)만 담당한다. NOT_FOUND/FORBIDDEN 모두 404 로 매핑해
// existence-leak 을 방지한다 (routes/projects.ts, routes/uploads.ts 와 동일 패턴).
// POST(P4-T3-08) 는 업로드→parser-pipeline→chunker→embedding dev-stub 까지 동기로 처리해
// indexStatus='indexed' 로 응답한다(실 큐/워커 인프라 미도입 — LOCAL_ONLY dev-stub, 배포 시 비동기 큐로 교체).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ProjectDocumentRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  DocumentServiceError,
  createDocumentService,
  type DocumentDataAccess,
  type DocumentIndexingDeps,
} from "../db/document-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import { ParserPipelineError } from "../knowledge/parser-pipeline.js";

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

export function createDocumentRoutes(
  deps: {
    da: DocumentDataAccess;
    objectStore: ObjectStore;
  } & Partial<DocumentIndexingDeps>,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();
  const service = createDocumentService(
    deps.da,
    deps.objectStore,
    deps.parserPipeline && deps.embeddingProvider
      ? {
          parserPipeline: deps.parserPipeline,
          embeddingProvider: deps.embeddingProvider,
        }
      : undefined,
  );

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

  app.post("/", async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.file;
    const projectId =
      typeof form?.projectId === "string" ? form.projectId : null;
    if (!file || !(file instanceof File) || !projectId) {
      return c.json(
        errorJson("INVALID_INPUT", "file, projectId 가 필요합니다."),
        400,
      );
    }
    const data = Buffer.from(await file.arrayBuffer());
    try {
      const doc = await service.indexDocument(actorOf(c), projectId, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        data,
      });
      return c.json(
        { data: toDto(doc), meta: { requestId: randomUUID() } },
        201,
      );
    } catch (err) {
      if (err instanceof ParserPipelineError) {
        return c.json(errorJson(err.code, err.message), 415);
      }
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

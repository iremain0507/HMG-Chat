// routes/documents.ts — 16-API-CONTRACT.md § 5 Project Documents 단일 출처.
// db/document-service.ts 가 project 읽기/쓰기 권한 매트릭스를 강제하므로, 여기선 HTTP 계층
// (쿼리/멀티파트 파싱/상태코드 매핑)만 담당한다. NOT_FOUND/FORBIDDEN 모두 404 로 매핑해
// existence-leak 을 방지한다 (routes/projects.ts, routes/uploads.ts 와 동일 패턴).
// POST(P4-T3-08) 는 업로드→parser-pipeline→chunker→embedding dev-stub 까지 동기로 처리해
// indexStatus='indexed' 로 응답한다(실 큐/워커 인프라 미도입 — LOCAL_ONLY dev-stub, 배포 시 비동기 큐로 교체).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type {
  NotificationEvent,
  ProjectDocumentRecord,
} from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import {
  DocumentServiceError,
  createDocumentService,
  type DocumentDataAccess,
  type DocumentIndexingDeps,
} from "../db/document-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import { ParserPipelineError } from "../knowledge/parser-pipeline.js";
import { filterAccessibleResourceIds } from "../lib/access-control.js";
import type { ResourceGrantsDataAccess } from "../db/resource-grants-data-access.js";

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
    grants?: ResourceGrantsDataAccess;
    // 인덱싱 완료 시 소유 사용자에게 document_indexed push (P22-T2-02). 미주입 시 no-op.
    notify?: (userId: string, event: NotificationEvent) => void;
  } & Partial<DocumentIndexingDeps>,
  // P22-T3-02 — nested=true 면 계약(§666-710) 형태로 마운트: projectId 를 부모 마운트
  // 경로파라미터(:id)에서 읽고, 문서 id 파라미터를 :docId 로 써서 :id 충돌을 피한다.
  // 기본(flat)은 기존 /api/v1/documents?projectId= 형태(back-compat) 그대로.
  opts?: { nested?: boolean },
): Hono<{ Variables: AuthedVariables }> {
  const nested = opts?.nested ?? false;
  // nested 마운트에선 문서 id 세그먼트를 :docId 로 (projectId 의 :id 와 충돌 방지).
  const docParam = nested ? "docId" : "id";
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

  // 인덱싱 완료(dev-stub 동기) 후 소유 사용자에게 document_indexed push (P22-T2-02).
  // indexStatus 가 'indexed' 일 때만 — 실패/보류 상태는 알리지 않는다.
  function notifyDocumentIndexed(
    userId: string,
    doc: ProjectDocumentRecord,
  ): void {
    if (!deps.notify || doc.indexStatus !== "indexed") return;
    deps.notify(userId, {
      type: "document_indexed",
      documentId: doc.id,
      projectId: doc.projectId,
      indexStatus: doc.indexStatus,
    });
  }

  function handleServiceError(err: unknown): {
    body: ReturnType<typeof errorJson>;
    status: 404 | 409;
  } {
    if (err instanceof DocumentServiceError) {
      if (err.code === "CONFLICT") {
        return { body: errorJson("CONFLICT", err.message), status: 409 };
      }
      // FORBIDDEN 도 404 로 매핑 — existence-leak 방지 (다른 org/비멤버에게 문서 존재 자체를 숨김).
      return { body: errorJson("NOT_FOUND", err.message), status: 404 };
    }
    throw err;
  }

  app.get("/", async (c) => {
    // nested: projectId 는 경로(:id)에서, flat: ?projectId 쿼리에서.
    const projectId = nested ? c.req.param("id") : c.req.query("projectId");
    if (!projectId) {
      return c.json(
        errorJson("INVALID_INPUT", "projectId 가 필요합니다."),
        400,
      );
    }
    const contentHash = c.req.query("contentHash");
    const actor = actorOf(c);
    try {
      const docs = await service.listDocumentsForActor(
        actor,
        projectId,
        contentHash ? { contentHash } : undefined,
      );
      let visible = docs;
      if (deps.grants) {
        const accessible = await filterAccessibleResourceIds(deps.grants, {
          orgId: actor.orgId,
          userId: actor.userId,
          resourceType: "knowledge",
          resourceIds: docs.map((d) => d.id),
          access: "read",
        });
        visible = docs.filter((d) => accessible.has(d.id));
      }
      return c.json({
        data: visible.map(toDto),
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
    // nested: projectId 는 경로(:id)에서, flat: multipart body 에서.
    const projectId = nested
      ? (c.req.param("id") ?? null)
      : typeof form?.projectId === "string"
        ? form.projectId
        : null;
    if (!file || !(file instanceof File) || !projectId) {
      return c.json(
        errorJson("INVALID_INPUT", "file, projectId 가 필요합니다."),
        400,
      );
    }
    const data = Buffer.from(await file.arrayBuffer());
    const actor = actorOf(c);
    try {
      const doc = await service.indexDocument(actor, projectId, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        data,
      });
      notifyDocumentIndexed(actor.userId, doc);
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

  app.get(`/:${docParam}`, async (c) => {
    const actor = actorOf(c);
    const found = await service.getDocumentForActor(
      actor,
      c.req.param(docParam),
    );
    if (!found) {
      return c.json(errorJson("NOT_FOUND", "문서를 찾을 수 없습니다."), 404);
    }
    if (deps.grants) {
      const accessible = await filterAccessibleResourceIds(deps.grants, {
        orgId: actor.orgId,
        userId: actor.userId,
        resourceType: "knowledge",
        resourceIds: [found.id],
        access: "read",
      });
      if (!accessible.has(found.id)) {
        return c.json(errorJson("NOT_FOUND", "문서를 찾을 수 없습니다."), 404);
      }
    }
    return c.json({ data: toDto(found), meta: { requestId: randomUUID() } });
  });

  app.post(`/:${docParam}/retry`, async (c) => {
    try {
      const actor = actorOf(c);
      const doc = await service.retryDocument(actor, c.req.param(docParam));
      notifyDocumentIndexed(actor.userId, doc);
      return c.json({ data: toDto(doc), meta: { requestId: randomUUID() } });
    } catch (err) {
      const { body, status } = handleServiceError(err);
      return c.json(body, status);
    }
  });

  app.delete(`/:${docParam}`, async (c) => {
    try {
      await service.deleteDocument(actorOf(c), c.req.param(docParam));
      return c.body(null, 204);
    } catch (err) {
      const { body, status } = handleServiceError(err);
      return c.json(body, status);
    }
  });

  return app;
}

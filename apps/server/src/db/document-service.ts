// db/document-service.ts — 16-API-CONTRACT.md § 5 Project Documents 단일 출처(목록/조회/삭제 범위).
// RLS(0005) 가 DB 레벨 read/write 를 강제하지만, dev/test DATABASE_URL role 은 superuser 라
// RLS 를 우회한다(db/project-service.ts 와 동일 근거) — 이 서비스가 project-service.ts 의
// getProjectForActor(visibility/role 권한 매트릭스)를 재사용해 문서 접근을 동일하게 강제한다.
// NOT_FOUND/FORBIDDEN 모두 라우트 레이어에서 404 로 매핑 — 다른 org 문서 존재 여부 노출 방지.
import { createHash, randomUUID } from "node:crypto";
import type {
  DataAccess,
  DocumentChunkRepo,
  EmbeddingProvider,
  ProjectDocumentRecord,
} from "@wchat/interfaces";
import {
  createProjectService,
  type ProjectActor,
  type ProjectDataAccess,
} from "./project-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import type { ParserPipeline } from "../knowledge/parser-types.js";
import { chunkText } from "../knowledge/chunker.js";
import type { ResolvedOrgSettings } from "../lib/org-settings-schema.js";

export type DocumentDataAccess = Pick<DataAccess, "projectDocuments"> &
  ProjectDataAccess & {
    documentChunks: Pick<DocumentChunkRepo, "insert" | "bulkInsert">;
  };

// P16-T1-01 — index 시점 org-scoped 청크 설정 조회 포트. deep-research-handler.ts 의
// ToolSettingsResolverPort 와 동일하게 SettingsService.resolve 와 구조적으로만 호환되는
// 최소 계약(DI, 순환 회피).
export interface ChunkSettingsResolverPort {
  resolve(
    orgId: string,
  ): Promise<
    Pick<ResolvedOrgSettings, "ragChunkSizeTokens" | "ragChunkOverlapTokens">
  >;
}

export interface DocumentIndexingDeps {
  parserPipeline: ParserPipeline;
  embeddingProvider: EmbeddingProvider;
  // 주입 시 index 시점에 actor.orgId 로 org 설정을 조회해 chunkText 에 반영.
  // 미주입/조회 실패 시 chunkText 기본값(DEFAULT_ORG_SETTINGS 800/100)으로 fail-soft
  // (21-LOOP-LESSONS.md L2 — settings 조회 실패로 인덱싱 자체가 죽어선 안 됨).
  settings?: ChunkSettingsResolverPort;
}

export interface IndexDocumentInput {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export class DocumentServiceError extends Error {
  code: "NOT_FOUND" | "FORBIDDEN";

  constructor(code: DocumentServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

async function resolveChunkOptions(
  settings: ChunkSettingsResolverPort | undefined,
  orgId: string,
): Promise<{
  chunkSizeTokens?: number | undefined;
  overlapTokens?: number | undefined;
}> {
  if (!settings) return {};
  try {
    const resolved = await settings.resolve(orgId);
    return {
      chunkSizeTokens: resolved.ragChunkSizeTokens,
      overlapTokens: resolved.ragChunkOverlapTokens,
    };
  } catch {
    return {};
  }
}

export function createDocumentService(
  da: DocumentDataAccess,
  objectStore: ObjectStore,
  indexing?: DocumentIndexingDeps,
) {
  const projectService = createProjectService(da);

  async function listDocumentsForActor(
    actor: ProjectActor,
    projectId: string,
    filter?: { contentHash?: string },
  ): Promise<ProjectDocumentRecord[]> {
    const access = await projectService.getProjectForActor(actor, projectId);
    if (!access) {
      throw new DocumentServiceError(
        "NOT_FOUND",
        "프로젝트를 찾을 수 없습니다.",
      );
    }
    if (filter?.contentHash) {
      const found = await da.projectDocuments.byContentHash(
        projectId,
        filter.contentHash,
      );
      return found ? [found] : [];
    }
    const page = await da.projectDocuments.list({ projectId });
    return page.items;
  }

  async function getDocumentForActor(
    actor: ProjectActor,
    documentId: string,
  ): Promise<ProjectDocumentRecord | null> {
    const doc = await da.projectDocuments.byId(documentId);
    if (!doc) return null;
    const access = await projectService.getProjectForActor(
      actor,
      doc.projectId,
    );
    if (!access) return null;
    return doc;
  }

  async function deleteDocument(
    actor: ProjectActor,
    documentId: string,
  ): Promise<void> {
    const doc = await da.projectDocuments.byId(documentId);
    if (!doc) {
      throw new DocumentServiceError("NOT_FOUND", "문서를 찾을 수 없습니다.");
    }
    const access = await projectService.getProjectForActor(
      actor,
      doc.projectId,
    );
    if (!access) {
      throw new DocumentServiceError("NOT_FOUND", "문서를 찾을 수 없습니다.");
    }
    if (access.role !== "owner" && access.role !== "editor") {
      throw new DocumentServiceError("FORBIDDEN", "삭제 권한이 없습니다.");
    }
    await objectStore.remove(doc.s3Key);
    await da.projectDocuments.delete(documentId);
  }

  async function indexDocument(
    actor: ProjectActor,
    projectId: string,
    input: IndexDocumentInput,
  ): Promise<ProjectDocumentRecord> {
    if (!indexing) {
      throw new Error(
        "indexDocument requires parserPipeline/embeddingProvider",
      );
    }
    const access = await projectService.getProjectForActor(actor, projectId);
    if (!access) {
      throw new DocumentServiceError(
        "NOT_FOUND",
        "프로젝트를 찾을 수 없습니다.",
      );
    }
    if (access.role !== "owner" && access.role !== "editor") {
      throw new DocumentServiceError("FORBIDDEN", "업로드 권한이 없습니다.");
    }

    const contentHash = createHash("sha256").update(input.data).digest("hex");
    const existing = await da.projectDocuments.byContentHash(
      projectId,
      contentHash,
    );
    if (existing) return existing;

    const s3Key = `documents/${projectId}/${contentHash}-${randomUUID()}`;
    await objectStore.put(s3Key, input.data);
    const doc = await da.projectDocuments.insert({
      projectId,
      filename: input.filename,
      contentHash,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      s3Key,
      createdBy: actor.userId,
    });

    try {
      const parsed = await indexing.parserPipeline.parse({
        bytes: input.data,
        mimeType: input.mimeType,
        filename: input.filename,
      });
      const chunkOptions = await resolveChunkOptions(
        indexing.settings,
        actor.orgId,
      );
      const chunks = chunkText(parsed.markdown, chunkOptions);
      const embeddings = chunks.length
        ? await indexing.embeddingProvider.embed(chunks.map((c) => c.content))
        : [];
      if (chunks.length) {
        await da.documentChunks.bulkInsert(
          chunks.map((c, i) => ({
            documentId: doc.id,
            chunkIndex: c.chunkIndex,
            content: c.content,
            tokenCount: c.tokenCount,
            embedding: embeddings[i] ?? null,
            metadata: {},
          })),
        );
      }
      return await da.projectDocuments.update(doc.id, {
        indexStatus: "indexed",
        chunkCount: chunks.length,
        indexedAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await da.projectDocuments.update(doc.id, {
        indexStatus: "failed",
        failureReason: message,
      });
      throw err;
    }
  }

  return {
    listDocumentsForActor,
    getDocumentForActor,
    deleteDocument,
    indexDocument,
  };
}

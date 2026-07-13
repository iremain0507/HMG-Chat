// db/document-service.ts — 16-API-CONTRACT.md § 5 Project Documents 단일 출처(목록/조회/삭제 범위).
// RLS(0005) 가 DB 레벨 read/write 를 강제하지만, dev/test DATABASE_URL role 은 superuser 라
// RLS 를 우회한다(db/project-service.ts 와 동일 근거) — 이 서비스가 project-service.ts 의
// getProjectForActor(visibility/role 권한 매트릭스)를 재사용해 문서 접근을 동일하게 강제한다.
// NOT_FOUND/FORBIDDEN 모두 라우트 레이어에서 404 로 매핑 — 다른 org 문서 존재 여부 노출 방지.
import type { DataAccess, ProjectDocumentRecord } from "@wchat/interfaces";
import {
  createProjectService,
  type ProjectActor,
  type ProjectDataAccess,
} from "./project-service.js";
import type { ObjectStore } from "../lib/object-store.js";

export type DocumentDataAccess = Pick<DataAccess, "projectDocuments"> &
  ProjectDataAccess;

export class DocumentServiceError extends Error {
  code: "NOT_FOUND" | "FORBIDDEN";

  constructor(code: DocumentServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function createDocumentService(
  da: DocumentDataAccess,
  objectStore: ObjectStore,
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

  return { listDocumentsForActor, getDocumentForActor, deleteDocument };
}

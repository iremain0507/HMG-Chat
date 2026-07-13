// db/__tests__/document-service.test.ts — P4-T3-07 acceptance.
// InMemory DocumentDataAccess(project-service.test.ts 와 동일 패턴, 실 Postgres 불요).
// project-service.ts 의 getProjectForActor 를 재사용해 read/write 권한을 동일하게 강제하는지,
// 다른 org/비멤버가 문서를 조회/삭제할 수 없는지(existence-leak 방지), content_hash dedup 조회를 검증한다.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  Project,
  ProjectDocumentRecord,
  ProjectMember,
} from "@wchat/interfaces";
import {
  createDocumentService,
  DocumentServiceError,
  type DocumentDataAccess,
} from "../document-service.js";
import type { ProjectActor } from "../project-service.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";

function makeInMemoryDocumentDataAccess(): DocumentDataAccess & {
  __setOrgUnits(userId: string, unitIds: string[]): void;
} {
  const projects = new Map<string, Project>();
  const members = new Map<string, ProjectMember>();
  const orgUnitsByUser = new Map<string, string[]>();
  const documents = new Map<string, ProjectDocumentRecord>();

  return {
    projects: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          archivedAt: null,
          createdAt: new Date(),
          ...data,
        } as Project;
        projects.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = projects.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        projects.set(id, updated);
        return updated;
      },
      async delete(id) {
        projects.delete(id);
      },
      async byId(id) {
        return projects.get(id) ?? null;
      },
      async list(filter) {
        const items = [...projects.values()].filter(
          (p) =>
            (!filter?.orgId || p.orgId === filter.orgId) &&
            (!filter?.visibility || p.visibility === filter.visibility),
        );
        return { items };
      },
      async byOwner(userId) {
        return [...projects.values()].filter((p) => p.ownerId === userId);
      },
    },
    projectMembers: {
      async insert(data) {
        members.set(`${data.projectId}:${data.userId}`, data);
        return data;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async upsert(input) {
        members.set(`${input.projectId}:${input.userId}`, input);
        return input;
      },
      async byKey(projectId, userId) {
        return members.get(`${projectId}:${userId}`) ?? null;
      },
      async updateRole(projectId, userId, role) {
        const existing = members.get(`${projectId}:${userId}`);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, role };
        members.set(`${projectId}:${userId}`, updated);
        return updated;
      },
      async deleteByKey(projectId, userId) {
        members.delete(`${projectId}:${userId}`);
      },
      async list(filter) {
        const items = [...members.values()].filter(
          (m) =>
            (!filter?.projectId || m.projectId === filter.projectId) &&
            (!filter?.userId || m.userId === filter.userId),
        );
        return { items };
      },
    },
    async orgUnitIdsForUser(userId) {
      return orgUnitsByUser.get(userId) ?? [];
    },
    __setOrgUnits(userId: string, unitIds: string[]) {
      orgUnitsByUser.set(userId, unitIds);
    },
    projectDocuments: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          indexStatus: "pending",
          chunkCount: 0,
          indexedAt: null,
          failureReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as ProjectDocumentRecord;
        documents.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = documents.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        documents.set(id, updated);
        return updated;
      },
      async delete(id) {
        documents.delete(id);
      },
      async byId(id) {
        return documents.get(id) ?? null;
      },
      async list(filter) {
        const items = [...documents.values()].filter(
          (d) =>
            (!filter?.projectId || d.projectId === filter.projectId) &&
            (!filter?.indexStatus || d.indexStatus === filter.indexStatus),
        );
        return { items };
      },
      async byContentHash(projectId, hash) {
        return (
          [...documents.values()].find(
            (d) => d.projectId === projectId && d.contentHash === hash,
          ) ?? null
        );
      },
      async updateIndexStatus(id, status, chunkCount) {
        const existing = documents.get(id);
        if (!existing) throw new Error("not found");
        documents.set(id, {
          ...existing,
          indexStatus: status,
          ...(chunkCount !== undefined ? { chunkCount } : {}),
        });
      },
    },
  };
}

describe("document-service 권한 매트릭스 + dedup", () => {
  let da: ReturnType<typeof makeInMemoryDocumentDataAccess>;
  let svc: ReturnType<typeof createDocumentService>;
  const orgId = randomUUID();
  const otherOrgId = randomUUID();

  const owner: ProjectActor = { userId: randomUUID(), orgId };
  const viewer: ProjectActor = { userId: randomUUID(), orgId };
  const nonMember: ProjectActor = { userId: randomUUID(), orgId };
  const otherOrgActor: ProjectActor = {
    userId: randomUUID(),
    orgId: otherOrgId,
  };

  let privateProject: Project;
  let doc: ProjectDocumentRecord;

  beforeEach(async () => {
    da = makeInMemoryDocumentDataAccess();
    svc = createDocumentService(da, createInMemoryObjectStore());

    privateProject = await da.projects.insert({
      orgId,
      ownerId: owner.userId,
      name: "Docs Project",
      description: null,
      visibility: "private",
      orgUnitId: null,
    });
    await da.projectMembers.upsert({
      projectId: privateProject.id,
      userId: owner.userId,
      role: "owner",
      createdAt: new Date(),
    });
    await da.projectMembers.upsert({
      projectId: privateProject.id,
      userId: viewer.userId,
      role: "viewer",
      createdAt: new Date(),
    });
    doc = await da.projectDocuments.insert({
      projectId: privateProject.id,
      filename: "a.pdf",
      contentHash: "hash-a",
      mimeType: "application/pdf",
      sizeBytes: 100,
      s3Key: "documents/hash-a",
      createdBy: owner.userId,
    });
  });

  it("project member(viewer) 는 문서 목록을 조회할 수 있다", async () => {
    const items = await svc.listDocumentsForActor(viewer, privateProject.id);
    expect(items.map((d) => d.id)).toEqual([doc.id]);
  });

  it("project 의 non-member 는 목록 조회 시 NOT_FOUND (existence-leak 방지)", async () => {
    await expect(
      svc.listDocumentsForActor(nonMember, privateProject.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("project member 는 문서 단건을 조회할 수 있다", async () => {
    const found = await svc.getDocumentForActor(viewer, doc.id);
    expect(found?.id).toBe(doc.id);
  });

  it("다른 org 의 actor 는 문서를 조회할 수 없다 (404 매핑용 null)", async () => {
    const found = await svc.getDocumentForActor(otherOrgActor, doc.id);
    expect(found).toBeNull();
  });

  it("존재하지 않는 문서 id 조회 시 null", async () => {
    const found = await svc.getDocumentForActor(owner, randomUUID());
    expect(found).toBeNull();
  });

  it("content_hash 로 dedup 조회할 수 있다", async () => {
    const items = await svc.listDocumentsForActor(owner, privateProject.id, {
      contentHash: "hash-a",
    });
    expect(items.map((d) => d.id)).toEqual([doc.id]);
  });

  it("content_hash 가 일치하는 문서가 없으면 빈 배열", async () => {
    const items = await svc.listDocumentsForActor(owner, privateProject.id, {
      contentHash: "no-such-hash",
    });
    expect(items).toEqual([]);
  });

  it("owner(write 권한) 는 문서를 삭제할 수 있다", async () => {
    await svc.deleteDocument(owner, doc.id);
    expect(await da.projectDocuments.byId(doc.id)).toBeNull();
  });

  it("viewer(write 권한 없음) 는 문서를 삭제할 수 없다 (FORBIDDEN)", async () => {
    await expect(svc.deleteDocument(viewer, doc.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await da.projectDocuments.byId(doc.id)).not.toBeNull();
  });

  it("다른 org 의 actor 가 삭제 시도하면 NOT_FOUND (existence-leak 방지)", async () => {
    await expect(
      svc.deleteDocument(otherOrgActor, doc.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("존재하지 않는 문서 삭제 시도하면 NOT_FOUND", async () => {
    await expect(
      svc.deleteDocument(owner, randomUUID()),
    ).rejects.toBeInstanceOf(DocumentServiceError);
  });
});

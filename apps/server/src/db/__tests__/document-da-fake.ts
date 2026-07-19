// document-da-fake.ts — 실 Postgres 불요 InMemory DocumentDataAccess.
// document-service.test.ts 와 routes/__tests__/documents-chunk-settings.test.ts 가 공유한다
// (project-service.test.ts 와 동일 패턴). 파일명이 *.test.ts 가 아니라 vitest include 대상이 아니다.
import { randomUUID } from "node:crypto";
import type {
  DocumentChunk,
  Project,
  ProjectDocumentRecord,
  ProjectMember,
} from "@wchat/interfaces";
import type { DocumentDataAccess } from "../document-service.js";

export function makeInMemoryDocumentDataAccess(): DocumentDataAccess & {
  __setOrgUnits(userId: string, unitIds: string[]): void;
  __chunks: Map<string, DocumentChunk>;
} {
  const projects = new Map<string, Project>();
  const members = new Map<string, ProjectMember>();
  const orgUnitsByUser = new Map<string, string[]>();
  const documents = new Map<string, ProjectDocumentRecord>();
  const chunks = new Map<string, DocumentChunk>();

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
    documentChunks: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          metadata: {},
          createdAt: new Date(),
          ...data,
        } as DocumentChunk;
        chunks.set(row.id, row);
        return row;
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((r) => this.insert(r)));
      },
      async list(filter) {
        const items = [...chunks.values()].filter(
          (ch) => !filter?.documentId || ch.documentId === filter.documentId,
        );
        return { items };
      },
      async delete(id) {
        chunks.delete(id);
      },
    },
    __chunks: chunks,
  };
}

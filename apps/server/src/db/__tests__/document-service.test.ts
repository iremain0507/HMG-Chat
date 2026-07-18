// db/__tests__/document-service.test.ts — P4-T3-07 acceptance.
// InMemory DocumentDataAccess(project-service.test.ts 와 동일 패턴, 실 Postgres 불요).
// project-service.ts 의 getProjectForActor 를 재사용해 read/write 권한을 동일하게 강제하는지,
// 다른 org/비멤버가 문서를 조회/삭제할 수 없는지(existence-leak 방지), content_hash dedup 조회를 검증한다.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type {
  EmbeddingProvider,
  Project,
  ProjectDocumentRecord,
} from "@wchat/interfaces";
import {
  createDocumentService,
  DocumentServiceError,
  type ChunkSettingsResolverPort,
} from "../document-service.js";
import { makeInMemoryDocumentDataAccess } from "./document-da-fake.js";
import type { ProjectActor } from "../project-service.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";
import type { ParserPipeline } from "../../knowledge/parser-types.js";
import { ParserPipelineError } from "../../knowledge/parser-pipeline.js";
import { chunkText } from "../../knowledge/chunker.js";

const fakeParserPipeline: ParserPipeline = {
  supports: () => true,
  async parse() {
    return { format: "docx", markdown: "hello world content" };
  },
};

const LONG_TEXT = "word ".repeat(3000).trim();

const longParserPipeline: ParserPipeline = {
  supports: () => true,
  async parse() {
    return { format: "docx", markdown: LONG_TEXT };
  },
};

const unsupportedParserPipeline: ParserPipeline = {
  supports: () => false,
  async parse() {
    throw new ParserPipelineError("지원하지 않는 문서 형식입니다.");
  },
};

const fakeEmbeddingProvider: EmbeddingProvider = {
  name: "fake",
  dim: 2,
  async embed(input) {
    return input.map(() => [0.1, 0.2]);
  },
};

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

describe("document-service indexDocument (P4-T3-08) — 업로드→파싱→청킹→임베딩", () => {
  let da: ReturnType<typeof makeInMemoryDocumentDataAccess>;
  let svc: ReturnType<typeof createDocumentService>;
  const orgId = randomUUID();

  const owner: ProjectActor = { userId: randomUUID(), orgId };
  const viewer: ProjectActor = { userId: randomUUID(), orgId };

  let project: Project;

  beforeEach(async () => {
    da = makeInMemoryDocumentDataAccess();
    svc = createDocumentService(da, createInMemoryObjectStore(), {
      parserPipeline: fakeParserPipeline,
      embeddingProvider: fakeEmbeddingProvider,
    });

    project = await da.projects.insert({
      orgId,
      ownerId: owner.userId,
      name: "Indexing Project",
      description: null,
      visibility: "private",
      orgUnitId: null,
    });
    await da.projectMembers.upsert({
      projectId: project.id,
      userId: owner.userId,
      role: "owner",
      createdAt: new Date(),
    });
    await da.projectMembers.upsert({
      projectId: project.id,
      userId: viewer.userId,
      role: "viewer",
      createdAt: new Date(),
    });
  });

  it("owner 는 파일을 업로드해 파싱→청킹→임베딩→chunk insert 까지 완료한다", async () => {
    const doc = await svc.indexDocument(owner, project.id, {
      filename: "hello.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from("fake docx bytes"),
    });
    expect(doc.indexStatus).toBe("indexed");
    expect(doc.chunkCount).toBeGreaterThan(0);
    expect(da.__chunks.size).toBe(doc.chunkCount);
    for (const chunk of da.__chunks.values()) {
      expect(chunk.documentId).toBe(doc.id);
      expect(chunk.embedding).toEqual([0.1, 0.2]);
    }
  });

  it("같은 content_hash 파일을 재업로드하면 기존 문서를 재사용한다 (dedup, 재파싱 없음)", async () => {
    const bytes = Buffer.from("same bytes");
    const first = await svc.indexDocument(owner, project.id, {
      filename: "a.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: bytes,
    });
    const second = await svc.indexDocument(owner, project.id, {
      filename: "a.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: bytes,
    });
    expect(second.id).toBe(first.id);
    expect(da.__chunks.size).toBe(first.chunkCount);
  });

  it("viewer(write 권한 없음) 는 업로드할 수 없다 (FORBIDDEN)", async () => {
    await expect(
      svc.indexDocument(viewer, project.id, {
        filename: "b.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: Buffer.from("b"),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("존재하지 않는 프로젝트면 NOT_FOUND", async () => {
    await expect(
      svc.indexDocument(owner, randomUUID(), {
        filename: "c.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        data: Buffer.from("c"),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("지원하지 않는 포맷이면 문서를 failed 로 마킹하고 에러를 던진다", async () => {
    const svc2 = createDocumentService(da, createInMemoryObjectStore(), {
      parserPipeline: unsupportedParserPipeline,
      embeddingProvider: fakeEmbeddingProvider,
    });
    await expect(
      svc2.indexDocument(owner, project.id, {
        filename: "d.xyz",
        mimeType: "application/octet-stream",
        data: Buffer.from("d"),
      }),
    ).rejects.toBeInstanceOf(ParserPipelineError);
    const failed = [...da.__chunks.values()];
    expect(failed).toHaveLength(0);
  });

  it("P16-T1-01: settings 미주입 시 chunkText 기본값(800)으로 청킹한다", async () => {
    const svcNoSettings = createDocumentService(
      da,
      createInMemoryObjectStore(),
      {
        parserPipeline: longParserPipeline,
        embeddingProvider: fakeEmbeddingProvider,
      },
    );
    const doc = await svcNoSettings.indexDocument(owner, project.id, {
      filename: "long.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from("long docx bytes"),
    });
    expect(doc.chunkCount).toBe(chunkText(LONG_TEXT).length);
  });

  it("P16-T1-01: org ragChunkSizeTokens=1200 이면 1200 기준으로 청킹한다(index 시점 org 컨텍스트)", async () => {
    const settingsResolver: ChunkSettingsResolverPort = {
      async resolve() {
        return { ragChunkSizeTokens: 1200, ragChunkOverlapTokens: 100 };
      },
    };
    const svcWithSettings = createDocumentService(
      da,
      createInMemoryObjectStore(),
      {
        parserPipeline: longParserPipeline,
        embeddingProvider: fakeEmbeddingProvider,
        settings: settingsResolver,
      },
    );
    const doc = await svcWithSettings.indexDocument(owner, project.id, {
      filename: "long-1200.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from("long docx bytes 1200"),
    });
    const expected = chunkText(LONG_TEXT, {
      chunkSizeTokens: 1200,
      overlapTokens: 100,
    }).length;
    expect(doc.chunkCount).toBe(expected);
    expect(doc.chunkCount).not.toBe(chunkText(LONG_TEXT).length);
  });

  it("P16-T1-01: settings.resolve 가 실패해도 인덱싱은 기본값(800)으로 fail-soft 한다", async () => {
    const failingResolver: ChunkSettingsResolverPort = {
      async resolve() {
        throw new Error("settings unavailable");
      },
    };
    const svcFailingSettings = createDocumentService(
      da,
      createInMemoryObjectStore(),
      {
        parserPipeline: longParserPipeline,
        embeddingProvider: fakeEmbeddingProvider,
        settings: failingResolver,
      },
    );
    const doc = await svcFailingSettings.indexDocument(owner, project.id, {
      filename: "long-failsoft.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from("long docx bytes failsoft"),
    });
    expect(doc.indexStatus).toBe("indexed");
    expect(doc.chunkCount).toBe(chunkText(LONG_TEXT).length);
  });
});

describe("document-service retryDocument (P17-T1-06 / TS-15) — 실패 문서 재인덱싱", () => {
  let da: ReturnType<typeof makeInMemoryDocumentDataAccess>;
  let objectStore: ReturnType<typeof createInMemoryObjectStore>;
  let svc: ReturnType<typeof createDocumentService>;
  const orgId = randomUUID();

  const owner: ProjectActor = { userId: randomUUID(), orgId };
  const viewer: ProjectActor = { userId: randomUUID(), orgId };
  const otherOrgActor: ProjectActor = {
    userId: randomUUID(),
    orgId: randomUUID(),
  };

  let project: Project;
  let failedDoc: ProjectDocumentRecord;

  beforeEach(async () => {
    da = makeInMemoryDocumentDataAccess();
    objectStore = createInMemoryObjectStore();
    svc = createDocumentService(da, objectStore, {
      parserPipeline: fakeParserPipeline,
      embeddingProvider: fakeEmbeddingProvider,
    });

    project = await da.projects.insert({
      orgId,
      ownerId: owner.userId,
      name: "Retry Project",
      description: null,
      visibility: "private",
      orgUnitId: null,
    });
    await da.projectMembers.upsert({
      projectId: project.id,
      userId: owner.userId,
      role: "owner",
      createdAt: new Date(),
    });
    await da.projectMembers.upsert({
      projectId: project.id,
      userId: viewer.userId,
      role: "viewer",
      createdAt: new Date(),
    });

    const s3Key = `documents/${project.id}/retry-fixture`;
    await objectStore.put(s3Key, Buffer.from("original bytes"));
    failedDoc = await da.projectDocuments.insert({
      projectId: project.id,
      filename: "broken.docx",
      contentHash: "hash-retry",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 100,
      s3Key,
      createdBy: owner.userId,
      indexStatus: "failed",
      failureReason: "parse error",
    });
    // 이전 실패 시도에서 남은 stale chunk — retry 는 이를 제거하고 새로 채워야 한다.
    await da.documentChunks.insert({
      documentId: failedDoc.id,
      chunkIndex: 0,
      content: "stale",
      tokenCount: 1,
      embedding: null,
      metadata: {},
    });
  });

  it("owner 는 실패한 문서를 재인덱싱해 indexed 로 전환한다 (기존 stale chunk 제거)", async () => {
    const result = await svc.retryDocument(owner, failedDoc.id);
    expect(result.indexStatus).toBe("indexed");
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(result.failureReason).toBeNull();
    const remaining = [...da.__chunks.values()].filter(
      (c) => c.documentId === failedDoc.id,
    );
    expect(remaining).toHaveLength(result.chunkCount);
    expect(remaining.every((c) => c.content !== "stale")).toBe(true);
  });

  it("indexStatus 가 'failed' 가 아니면 CONFLICT", async () => {
    const indexedDoc = await da.projectDocuments.update(failedDoc.id, {
      indexStatus: "indexed",
    });
    await expect(svc.retryDocument(owner, indexedDoc.id)).rejects.toMatchObject(
      { code: "CONFLICT" },
    );
  });

  it("viewer(write 권한 없음) 는 재시도할 수 없다 (FORBIDDEN)", async () => {
    await expect(svc.retryDocument(viewer, failedDoc.id)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });

  it("다른 org 의 actor 가 재시도하면 NOT_FOUND (existence-leak 방지)", async () => {
    await expect(
      svc.retryDocument(otherOrgActor, failedDoc.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("존재하지 않는 문서 id 는 NOT_FOUND", async () => {
    await expect(svc.retryDocument(owner, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("파싱이 다시 실패하면 failed 로 마킹하고 에러를 던진다", async () => {
    const svcFailing = createDocumentService(da, objectStore, {
      parserPipeline: unsupportedParserPipeline,
      embeddingProvider: fakeEmbeddingProvider,
    });
    await expect(
      svcFailing.retryDocument(owner, failedDoc.id),
    ).rejects.toBeInstanceOf(ParserPipelineError);
    const after = await da.projectDocuments.byId(failedDoc.id);
    expect(after?.indexStatus).toBe("failed");
  });
});

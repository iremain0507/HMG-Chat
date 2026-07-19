// db/__tests__/upload-service.test.ts — P4-T3-01 acceptance 단위: 업로드 sha256 dedup +
// 소유자 격리(다른 유저 조회/삭제 불가) + delete 시 ObjectStore 객체도 함께 제거.
// InMemory UploadDataAccess + InMemory ObjectStore — 09-TDD-GUIDE.md § Mock vs Real 정책(unit test, 실 Postgres/FS 불요).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { UploadRecord } from "@wchat/interfaces";
import { createInMemoryObjectStore } from "../../lib/object-store.js";
import { createParserPipeline } from "../../knowledge/parser-pipeline.js";
import { createDevStubEmbeddingProvider } from "../../knowledge/embedding-provider-dev-stub.js";
import type { EphemeralChunkRow } from "../../knowledge/ephemeral-indexer.js";
import {
  createUploadService,
  UploadServiceError,
  type UploadDataAccess,
} from "../upload-service.js";

function makeInMemoryUploadDataAccess(): UploadDataAccess {
  const rows = new Map<string, UploadRecord>();
  return {
    uploads: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as UploadRecord;
        rows.set(row.id, row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = rows.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        rows.set(id, updated);
        return updated;
      },
      async delete(id) {
        rows.delete(id);
      },
      async byId(id) {
        return rows.get(id) ?? null;
      },
      async list(filter) {
        const items = [...rows.values()].filter(
          (r) => !filter?.userId || r.userId === filter.userId,
        );
        return { items };
      },
      async bySha256(userId, sha256) {
        return (
          [...rows.values()].find(
            (r) => r.userId === userId && r.sha256 === sha256,
          ) ?? null
        );
      },
      async expiredOlderThan(cutoff) {
        return [...rows.values()].filter((r) => r.expiresAt < cutoff);
      },
    },
  };
}

describe("upload-service", () => {
  let da: UploadDataAccess;
  let objectStore: ReturnType<typeof createInMemoryObjectStore>;
  const userA = randomUUID();
  const userB = randomUUID();

  beforeEach(() => {
    da = makeInMemoryUploadDataAccess();
    objectStore = createInMemoryObjectStore();
  });

  it("파일을 저장하고 uploads row(s3_key 포함)를 생성한다", async () => {
    const service = createUploadService(da, objectStore);
    const upload = await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    expect(upload.userId).toBe(userA);
    expect(upload.filename).toBe("a.txt");
    expect(upload.sizeBytes).toBe(5);
    expect(await objectStore.exists(upload.s3Key)).toBe(true);
  });

  it("동일 유저가 같은 바이트를 다시 업로드하면 기존 row 를 재사용한다 (sha256 dedup)", async () => {
    const service = createUploadService(da, objectStore);
    const first = await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    const second = await service.createUpload(
      { userId: userA },
      {
        filename: "a-renamed.txt",
        mimeType: "text/plain",
        data: Buffer.from("hello"),
      },
    );
    expect(second.id).toBe(first.id);
  });

  it("다른 유저는 남의 업로드를 조회할 수 없다", async () => {
    const service = createUploadService(da, objectStore);
    const upload = await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    const found = await service.getUploadForActor({ userId: userB }, upload.id);
    expect(found).toBeNull();
  });

  it("삭제 시 DB row 와 ObjectStore 객체가 모두 제거된다", async () => {
    const service = createUploadService(da, objectStore);
    const upload = await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    await service.deleteUpload({ userId: userA }, upload.id);
    expect(await da.uploads.byId(upload.id)).toBeNull();
    expect(await objectStore.exists(upload.s3Key)).toBe(false);
  });

  it("다른 유저가 삭제 시도하면 NOT_FOUND 에러 (existence-leak 방지)", async () => {
    const service = createUploadService(da, objectStore);
    const upload = await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    await expect(
      service.deleteUpload({ userId: userB }, upload.id),
    ).rejects.toThrow(UploadServiceError);
  });
});

describe("upload-service — ephemeral 인덱싱 배선 (P20-T1-01)", () => {
  let da: UploadDataAccess;
  let objectStore: ReturnType<typeof createInMemoryObjectStore>;
  const userA = randomUUID();
  const parserPipeline = createParserPipeline();
  const embeddingProvider = createDevStubEmbeddingProvider();

  beforeEach(() => {
    da = makeInMemoryUploadDataAccess();
    objectStore = createInMemoryObjectStore();
  });

  it("sessionId + indexing deps 가 있으면 ephemeral_chunks row 를 만들어 bulkInsert 로 전달한다", async () => {
    const inserted: EphemeralChunkRow[] = [];
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      bulkInsert: async (rows) => {
        inserted.push(...rows);
      },
    });
    const sessionId = randomUUID();
    const upload = await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data: Buffer.from("분기 매출은 1000억원이며 전년 대비 12% 증가했다."),
        sessionId,
      },
    );
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0]?.uploadId).toBe(upload.id);
    expect(inserted[0]?.sessionId).toBe(sessionId);
  });

  it("indexing deps 를 주입하지 않으면 인덱서가 동작하지 않는다 (L1 조립 가드) — 업로드 자체는 성공", async () => {
    const service = createUploadService(da, objectStore);
    const upload = await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data: Buffer.from("hello"),
        sessionId: randomUUID(),
      },
    );
    expect(upload.filename).toBe("a.txt");
  });

  it("sessionId 없이 업로드하면 인덱싱을 시도하지 않는다", async () => {
    let called = false;
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      bulkInsert: async () => {
        called = true;
      },
    });
    await service.createUpload(
      { userId: userA },
      { filename: "a.txt", mimeType: "text/plain", data: Buffer.from("hello") },
    );
    expect(called).toBe(false);
  });

  it("인덱싱 중 에러가 발생해도 업로드 자체는 성공한다 (fail-soft, 트랜잭션 분리)", async () => {
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      bulkInsert: async () => {
        throw new Error("db down");
      },
    });
    const upload = await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data: Buffer.from("hello world"),
        sessionId: randomUUID(),
      },
    );
    expect(upload.filename).toBe("a.txt");
  });
});

// P22-T3-03 — org-scoped chunk 설정을 ephemeral(첨부) 인덱싱 경로에도 반영.
// CreateUploadInput.chunkOptions 로 per-request 청크 크기/오버랩을 주입하면
// indexEphemeralUpload deps.chunkOptions 를 오버라이드해야 한다(현재는 정적 indexing
// deps 만 쓰여 org 설정이 무시됨 — DEFAULT 800/100 고정). sha256 dedup 재인덱싱 경로도 동일.
describe("upload-service — ephemeral org-scoped chunkOptions (P22-T3-03)", () => {
  let da: UploadDataAccess;
  let objectStore: ReturnType<typeof createInMemoryObjectStore>;
  const userA = randomUUID();
  const parserPipeline = createParserPipeline();
  const embeddingProvider = createDevStubEmbeddingProvider();
  // 40 단어: 기본(800토큰≈640단어)이면 1청크, chunkSizeTokens=5(≈4단어)면 다청크.
  const longText = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");

  beforeEach(() => {
    da = makeInMemoryUploadDataAccess();
    objectStore = createInMemoryObjectStore();
  });

  it("createUpload input.chunkOptions 가 ephemeral 인덱싱의 청크 경계에 반영된다(작은 chunkSizeTokens→다청크)", async () => {
    const inserted: EphemeralChunkRow[] = [];
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      // 정적 deps 는 기본값(주입 안함) — per-request override 만으로 다청크가 되어야 한다.
      bulkInsert: async (rows) => {
        inserted.push(...rows);
      },
    });
    await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data: Buffer.from(longText),
        sessionId: randomUUID(),
        chunkOptions: { chunkSizeTokens: 5, overlapTokens: 0 },
      },
    );
    // 기본 800토큰이면 40단어는 1청크. 5토큰(≈4단어)면 10청크.
    expect(inserted.length).toBeGreaterThan(5);
  });

  it("chunkOptions 미지정 시 기본값(DEFAULT 800/100)으로 동작한다(fail-soft 회귀 없음)", async () => {
    const inserted: EphemeralChunkRow[] = [];
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      bulkInsert: async (rows) => {
        inserted.push(...rows);
      },
    });
    await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data: Buffer.from(longText),
        sessionId: randomUUID(),
      },
    );
    // 기본 800토큰(≈640단어) → 40단어는 단일 청크.
    expect(inserted.length).toBe(1);
  });

  it("sha256 dedup 재인덱싱(같은 바이트·다른 세션) 경로에도 chunkOptions 가 적용된다", async () => {
    const inserted: EphemeralChunkRow[] = [];
    const service = createUploadService(da, objectStore, {
      parserPipeline,
      embeddingProvider,
      bulkInsert: async (rows) => {
        inserted.push(...rows);
      },
    });
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const data = Buffer.from(longText);
    await service.createUpload(
      { userId: userA },
      {
        filename: "a.txt",
        mimeType: "text/plain",
        data,
        sessionId: sessionA,
        chunkOptions: { chunkSizeTokens: 5, overlapTokens: 0 },
      },
    );
    inserted.length = 0; // 재인덱싱 분기만 관찰
    await service.createUpload(
      { userId: userA },
      {
        filename: "a-renamed.txt",
        mimeType: "text/plain",
        data,
        sessionId: sessionB,
        chunkOptions: { chunkSizeTokens: 5, overlapTokens: 0 },
      },
    );
    // dedup 재인덱싱된 sessionB 청크도 다청크로 쪼개져야 한다.
    expect(inserted.length).toBeGreaterThan(5);
    expect(inserted.every((r) => r.sessionId === sessionB)).toBe(true);
  });
});

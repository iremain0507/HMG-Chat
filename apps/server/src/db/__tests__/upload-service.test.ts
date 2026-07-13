// db/__tests__/upload-service.test.ts — P4-T3-01 acceptance 단위: 업로드 sha256 dedup +
// 소유자 격리(다른 유저 조회/삭제 불가) + delete 시 ObjectStore 객체도 함께 제거.
// InMemory UploadDataAccess + InMemory ObjectStore — 09-TDD-GUIDE.md § Mock vs Real 정책(unit test, 실 Postgres/FS 불요).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { UploadRecord } from "@wchat/interfaces";
import { createInMemoryObjectStore } from "../../lib/object-store.js";
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

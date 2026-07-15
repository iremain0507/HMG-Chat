// db/__tests__/artifact-service.test.ts — P5-T1-01 acceptance 단위: storageKind 라우팅(256_000B 임계치)
// + 생성자 격리(다른 유저 조회/삭제 불가, existence-leak 방지). InMemory ArtifactDataAccess —
// 09-TDD-GUIDE.md § Mock vs Real 정책(unit test, 실 Postgres 불요).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord } from "@wchat/interfaces";
import {
  createArtifactService,
  ArtifactServiceError,
  decideStorageKind,
  INLINE_STORAGE_THRESHOLD_BYTES,
  type ArtifactDataAccess,
} from "../artifact-service.js";

function makeInMemoryArtifactDataAccess(): ArtifactDataAccess {
  const rows = new Map<string, ArtifactRecord>();
  return {
    artifacts: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactRecord;
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
          (r) => !filter?.createdBy || r.createdBy === filter.createdBy,
        );
        return { items };
      },
    },
  };
}

describe("decideStorageKind", () => {
  it("256_000 바이트 미만이면 inline", () => {
    expect(decideStorageKind(INLINE_STORAGE_THRESHOLD_BYTES - 1)).toBe(
      "inline",
    );
  });

  it("256_000 바이트 이상이면 s3", () => {
    expect(decideStorageKind(INLINE_STORAGE_THRESHOLD_BYTES)).toBe("s3");
  });
});

describe("artifact-service", () => {
  let da: ArtifactDataAccess;
  const userA = randomUUID();
  const userB = randomUUID();

  beforeEach(() => {
    da = makeInMemoryArtifactDataAccess();
  });

  it("작은 파일은 inline 으로 저장한다 (inlineContent 채움, s3Key null)", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      {
        type: "markdown",
        filename: "note.md",
        data: Buffer.from("hello artifact"),
      },
    );
    expect(artifact.storageKind).toBe("inline");
    expect(artifact.inlineContent).toEqual(Buffer.from("hello artifact"));
    expect(artifact.s3Key).toBeNull();
    expect(artifact.sizeBytes).toBe(Buffer.byteLength("hello artifact"));
    expect(artifact.createdBy).toBe(userA);
  });

  it("큰 파일은 s3 로 라우팅한다 (s3Key 필수, inlineContent null)", async () => {
    const service = createArtifactService(da);
    const big = Buffer.alloc(INLINE_STORAGE_THRESHOLD_BYTES);
    const artifact = await service.createArtifact(
      { userId: userA },
      {
        type: "pptx",
        filename: "deck.pptx",
        data: big,
        s3Key: "artifacts/deck.pptx",
      },
    );
    expect(artifact.storageKind).toBe("s3");
    expect(artifact.s3Key).toBe("artifacts/deck.pptx");
    expect(artifact.inlineContent).toBeNull();
  });

  it("s3 라우팅인데 s3Key 를 주지 않으면 INVALID_INPUT", async () => {
    const service = createArtifactService(da);
    const big = Buffer.alloc(INLINE_STORAGE_THRESHOLD_BYTES);
    await expect(
      service.createArtifact(
        { userId: userA },
        { type: "pptx", filename: "deck.pptx", data: big },
      ),
    ).rejects.toThrow(ArtifactServiceError);
  });

  it("sessionId 없이 생성 가능하다 (session_id NULL 허용)", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      { type: "markdown", filename: "note.md", data: Buffer.from("hi") },
    );
    expect(artifact.sessionId).toBeNull();
  });

  it("생성자 본인은 조회할 수 있다", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      { type: "markdown", filename: "note.md", data: Buffer.from("hi") },
    );
    const found = await service.getArtifactForActor(
      { userId: userA },
      artifact.id,
    );
    expect(found?.id).toBe(artifact.id);
  });

  it("다른 유저는 조회할 수 없다 (existence-leak 방지)", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      { type: "markdown", filename: "note.md", data: Buffer.from("hi") },
    );
    const found = await service.getArtifactForActor(
      { userId: userB },
      artifact.id,
    );
    expect(found).toBeNull();
  });

  it("다른 유저가 삭제 시도하면 NOT_FOUND 에러", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      { type: "markdown", filename: "note.md", data: Buffer.from("hi") },
    );
    await expect(
      service.deleteArtifact({ userId: userB }, artifact.id),
    ).rejects.toThrow(ArtifactServiceError);
  });

  it("생성자 본인은 삭제할 수 있다", async () => {
    const service = createArtifactService(da);
    const artifact = await service.createArtifact(
      { userId: userA },
      { type: "markdown", filename: "note.md", data: Buffer.from("hi") },
    );
    await service.deleteArtifact({ userId: userA }, artifact.id);
    expect(await da.artifacts.byId(artifact.id)).toBeNull();
  });
});

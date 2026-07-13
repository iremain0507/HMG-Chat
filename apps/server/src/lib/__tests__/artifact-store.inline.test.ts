// artifact-store.inline.test.ts — P5-T4-01 RED: lib/artifact-store.inline.ts 모듈 부재.
// 14-INTERFACES § 4 ArtifactStore — storage_kind='inline' 인 artifact 는 바이트가 이미
// artifacts.inline_content 컬럼에 있으므로, 이 store 는 ArtifactRepo 읽기로 get/getInline 을 채운다.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord, ArtifactRepo } from "@wchat/interfaces";
import { createInlineArtifactStore } from "../artifact-store.inline.js";

function makeRepo(rows: ArtifactRecord[]): Pick<ArtifactRepo, "byId"> {
  return {
    async byId(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
  };
}

function makeArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    id: randomUUID(),
    sessionId: null,
    createdBy: randomUUID(),
    type: "markdown",
    filename: "note.md",
    mimeType: "text/markdown",
    sizeBytes: 5,
    storageKind: "inline",
    s3Key: null,
    inlineContent: Buffer.from("hello"),
    sharedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("createInlineArtifactStore", () => {
  it("put() 는 외부 저장 없이 locator=artifactId 반환", async () => {
    const store = createInlineArtifactStore(makeRepo([]));
    const artifactId = randomUUID();
    const result = await store.put({
      artifactId,
      content: Buffer.from("x"),
      sizeBytes: 1,
      mimeType: "text/plain",
    });
    expect(result).toEqual({ storageKind: "inline", locator: artifactId });
  });

  it("get() 은 ArtifactRepo 의 inline_content 를 스트림으로 반환", async () => {
    const artifact = makeArtifact();
    const store = createInlineArtifactStore(makeRepo([artifact]));
    const stream = await store.get(artifact.id);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("hello");
  });

  it("getInline() 은 content/mimeType/truncated 를 반환하고 maxBytes 초과 시 truncate", async () => {
    const artifact = makeArtifact({
      inlineContent: Buffer.from("hello world"),
    });
    const store = createInlineArtifactStore(makeRepo([artifact]));

    const full = await store.getInline(artifact.id);
    expect(full).toEqual({
      content: Buffer.from("hello world"),
      mimeType: "text/markdown",
      truncated: false,
    });

    const truncated = await store.getInline(artifact.id, 5);
    expect(truncated.content.toString()).toBe("hello");
    expect(truncated.truncated).toBe(true);
  });

  it("존재하지 않거나 inline 이 아닌 artifact 는 get() 이 reject", async () => {
    const store = createInlineArtifactStore(makeRepo([]));
    await expect(store.get(randomUUID())).rejects.toThrow();
  });
});

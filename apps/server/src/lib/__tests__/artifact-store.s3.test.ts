// artifact-store.s3.test.ts — P5-T4-01 RED: lib/artifact-store.s3.ts 모듈 부재.
// LOCAL_ONLY 환경엔 실 S3 가 없으므로 lib/object-store.ts(ObjectStore)에 위임 — 배포 시
// 동일 포트의 실 S3 구현으로 교체.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createInMemoryObjectStore } from "../object-store.js";
import { createS3ArtifactStore } from "../artifact-store.s3.js";

describe("createS3ArtifactStore", () => {
  it("put() 은 objectStore 에 저장하고 storageKind=s3 + locator=key 반환", async () => {
    const objectStore = createInMemoryObjectStore();
    const store = createS3ArtifactStore(objectStore);
    const artifactId = randomUUID();
    const data = Buffer.alloc(10 * 1024 * 1024, "a"); // 10MB pptx 시뮬레이션

    const result = await store.put({
      artifactId,
      content: data,
      sizeBytes: data.byteLength,
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    expect(result.storageKind).toBe("s3");
    expect(result.locator).toBe(`artifacts/${artifactId}`);
    expect(await objectStore.exists(result.locator)).toBe(true);
  });

  it("get() 은 저장된 바이트를 스트림으로 반환", async () => {
    const objectStore = createInMemoryObjectStore();
    const store = createS3ArtifactStore(objectStore);
    const artifactId = randomUUID();
    await store.put({
      artifactId,
      content: Buffer.from("s3 content"),
      sizeBytes: 10,
      mimeType: "text/plain",
    });

    const stream = await store.get(artifactId);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("s3 content");
  });

  it("getInline() 은 maxBytes 초과 시 truncate", async () => {
    const objectStore = createInMemoryObjectStore();
    const store = createS3ArtifactStore(objectStore);
    const artifactId = randomUUID();
    await store.put({
      artifactId,
      content: Buffer.from("hello world"),
      sizeBytes: 11,
      mimeType: "text/plain",
    });

    const truncated = await store.getInline(artifactId, 5);
    expect(truncated.content.toString()).toBe("hello");
    expect(truncated.truncated).toBe(true);
  });

  it("remove() 는 objectStore 에서 삭제", async () => {
    const objectStore = createInMemoryObjectStore();
    const store = createS3ArtifactStore(objectStore);
    const artifactId = randomUUID();
    await store.put({
      artifactId,
      content: Buffer.from("x"),
      sizeBytes: 1,
      mimeType: "text/plain",
    });

    await store.remove(artifactId);
    expect(await objectStore.exists(`artifacts/${artifactId}`)).toBe(false);
  });
});

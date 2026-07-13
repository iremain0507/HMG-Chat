// artifact-store.s3.ts — 14-INTERFACES § 4 ArtifactStore 의 s3 구현.
// LOCAL_ONLY 환경엔 실 S3 가 없으므로 lib/object-store.ts(ObjectStore, 로컬 FS/in-memory)에
// 위임한다 — 배포 시 동일 포트의 실 S3 구현으로 교체(prod). key 는 `artifacts/${artifactId}`.
import { Readable } from "node:stream";
import type { ArtifactStore } from "@wchat/interfaces";
import type { ObjectStore } from "./object-store.js";

function keyFor(artifactId: string): string {
  return `artifacts/${artifactId}`;
}

async function toBuffer(
  content: Buffer | NodeJS.ReadableStream,
): Promise<Buffer> {
  if (Buffer.isBuffer(content)) return content;
  const chunks: Buffer[] = [];
  for await (const chunk of content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createS3ArtifactStore(objectStore: ObjectStore): ArtifactStore {
  return {
    async put(input) {
      const key = keyFor(input.artifactId);
      await objectStore.put(key, await toBuffer(input.content));
      return { storageKind: "s3", locator: key };
    },

    async get(artifactId) {
      const data = await objectStore.get(keyFor(artifactId));
      return Readable.from(data);
    },

    async getInline(artifactId, maxBytes) {
      const data = await objectStore.get(keyFor(artifactId));
      const truncated = maxBytes != null && data.byteLength > maxBytes;
      return {
        content: truncated ? data.subarray(0, maxBytes) : data,
        mimeType: "application/octet-stream",
        truncated,
      };
    },

    async remove(artifactId) {
      await objectStore.remove(keyFor(artifactId));
    },

    async cleanupExpired() {
      return { deletedCount: 0 };
    },
  };
}

// artifact-store.inline.ts — 14-INTERFACES § 4 ArtifactStore 의 inline(DB BYTEA) 구현.
// storage_kind='inline' 인 artifact 는 바이트가 이미 artifacts.inline_content 컬럼에 있다
// (db/artifact-service.ts createArtifact() 가 직접 insert) — 이 store 는 외부 저장 없이
// ArtifactRepo 읽기로 get/getInline 을 채운다. put() 은 호출자가 별도로 DB row 를 쓸 것을
// 전제로 locator=artifactId 만 반환한다.
import { Readable } from "node:stream";
import type { ArtifactRepo, ArtifactStore } from "@wchat/interfaces";

async function loadInlineContent(
  repo: Pick<ArtifactRepo, "byId">,
  artifactId: string,
): Promise<{ content: Buffer; mimeType: string | null }> {
  const found = await repo.byId(artifactId);
  if (!found || found.storageKind !== "inline" || !found.inlineContent) {
    throw new Error(
      `artifact-store(inline): '${artifactId}' 의 inline content 를 찾을 수 없습니다.`,
    );
  }
  return { content: found.inlineContent, mimeType: found.mimeType };
}

export function createInlineArtifactStore(
  repo: Pick<ArtifactRepo, "byId">,
): ArtifactStore {
  return {
    async put(input) {
      return { storageKind: "inline", locator: input.artifactId };
    },

    async get(artifactId) {
      const { content } = await loadInlineContent(repo, artifactId);
      return Readable.from(content);
    },

    async getInline(artifactId, maxBytes) {
      const { content, mimeType } = await loadInlineContent(repo, artifactId);
      const truncated = maxBytes != null && content.byteLength > maxBytes;
      return {
        content: truncated ? content.subarray(0, maxBytes) : content,
        mimeType: mimeType ?? "application/octet-stream",
        truncated,
      };
    },

    async remove() {
      // DB row(및 inline_content) 삭제는 db/artifact-service.ts deleteArtifact() 소관 — no-op.
    },

    // inline artifact 의 바이트는 artifacts.inline_content 컬럼 자체다 — 별도 오브젝트가 없어
    // 이 store 가 지울 외부 바이트도 없다. 실제 삭제는 호출자(data-retention.ts)의 DB row
    // 삭제로 완료되므로, 처리 대상 건수를 그대로 돌려준다(remove() 가 no-op 인 것과 같은 이유).
    async cleanupExpired(input) {
      return { deletedCount: input?.artifactIds.length ?? 0 };
    },
  };
}

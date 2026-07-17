import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { indexEphemeralUpload } from "../ephemeral-indexer.js";
import { createParserPipeline } from "../parser-pipeline.js";
import { createDevStubEmbeddingProvider } from "../embedding-provider-dev-stub.js";

const embeddingProvider = createDevStubEmbeddingProvider();
const parserPipeline = createParserPipeline();

describe("indexEphemeralUpload", () => {
  it("markdown 첨부를 parse→chunk→embed 해 EphemeralChunk row 배열을 순수 반환한다 (DB 접근 없음)", async () => {
    const sessionId = randomUUID();
    const uploadId = randomUUID();
    const words = Array.from({ length: 1200 }, (_, i) => `word${i}`).join(" ");

    const rows = await indexEphemeralUpload(
      {
        bytes: Buffer.from(words, "utf-8"),
        mimeType: "text/markdown",
        filename: "notes.md",
        uploadId,
        sessionId,
      },
      { parserPipeline, embeddingProvider },
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.sessionId).toBe(sessionId);
      expect(row.uploadId).toBe(uploadId);
      expect(row.content.length).toBeGreaterThan(0);
      expect(row.embedding).toHaveLength(embeddingProvider.dim);
      expect(row.pageNumber).toBeNull();
      expect(typeof row.chunkIndex).toBe("number");
      expect(row.metadata).toEqual({});
    }
    // chunkIndex 는 0부터 연속.
    expect(rows.map((r) => r.chunkIndex)).toEqual(rows.map((_, i) => i));
  });

  it("plain text(.txt) 첨부도 지원한다(parser-pipeline 미지원 포맷 — bytes 를 직접 markdown 으로 취급)", async () => {
    const sessionId = randomUUID();
    const uploadId = randomUUID();

    const rows = await indexEphemeralUpload(
      {
        bytes: Buffer.from("hello plain text world", "utf-8"),
        mimeType: "text/plain",
        filename: "note.txt",
        uploadId,
        sessionId,
      },
      { parserPipeline, embeddingProvider },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toContain("hello plain text world");
    expect(rows[0]?.embedding).toHaveLength(embeddingProvider.dim);
  });

  it("0014_uploads.sql ephemeral_chunks 컬럼과 1:1 매핑되는 shape 을 반환한다 (bulkInsert 바로 소비 가능)", async () => {
    const sessionId = randomUUID();
    const uploadId = randomUUID();

    const rows = await indexEphemeralUpload(
      {
        bytes: Buffer.from("short doc", "utf-8"),
        mimeType: "text/plain",
        filename: "a.txt",
        uploadId,
        sessionId,
      },
      { parserPipeline, embeddingProvider },
    );

    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "sessionId",
        "uploadId",
        "chunkIndex",
        "pageNumber",
        "content",
        "embedding",
        "metadata",
      ].sort(),
    );
  });

  it("빈 문서(공백만)는 빈 배열을 반환한다 (L2 열화조건)", async () => {
    const rows = await indexEphemeralUpload(
      {
        bytes: Buffer.from("   \n  ", "utf-8"),
        mimeType: "text/plain",
        filename: "empty.txt",
        uploadId: randomUUID(),
        sessionId: randomUUID(),
      },
      { parserPipeline, embeddingProvider },
    );
    expect(rows).toEqual([]);
  });

  it("미지원 바이너리 포맷은 빈 배열을 반환한다(fail-soft, throw 하지 않음)", async () => {
    const rows = await indexEphemeralUpload(
      {
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        mimeType: "image/png",
        filename: "a.png",
        uploadId: randomUUID(),
        sessionId: randomUUID(),
      },
      { parserPipeline, embeddingProvider },
    );
    expect(rows).toEqual([]);
  });
});

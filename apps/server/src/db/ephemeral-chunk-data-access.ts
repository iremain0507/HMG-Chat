// db/ephemeral-chunk-data-access.ts — P20-T1-01: ephemeral-indexer.ts(T3, 순수함수) 의
// 반환값을 ephemeral_chunks(0014_uploads.sql)에 실제 INSERT 하는 생산측. 조회는
// ephemeral-chunk-search.ts(P17-T1-05)가 이미 담당 — 여기는 적재만.
import type { EphemeralChunkRow } from "../knowledge/ephemeral-indexer.js";
import { pgPool } from "./client.js";

// pgvector 는 `[0.1,0.2,...]` 텍스트 리터럴을 ::vector 로 캐스트해 받는다
// (project-document-data-access.ts toVectorLiteral 과 동일 패턴).
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export async function bulkInsertEphemeralChunks(
  rows: EphemeralChunkRow[],
): Promise<void> {
  for (const row of rows) {
    await pgPool.query(
      `INSERT INTO ephemeral_chunks (session_id, upload_id, chunk_index, page_number, content, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)`,
      [
        row.sessionId,
        row.uploadId,
        row.chunkIndex,
        row.pageNumber,
        row.content,
        toVectorLiteral(row.embedding),
        JSON.stringify(row.metadata ?? {}),
      ],
    );
  }
}

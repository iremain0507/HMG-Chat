// db/ephemeral-chunk-search.ts — P17-T1-05(TS-14): routes/messages.ts 의
// AttachmentsPort(resolveEphemeralContext/searchEphemeralChunks) pg 구현체.
// 0014_uploads.sql 의 ephemeral_chunks 를 hybridSearch(knowledge/search-service.ts)로
// 검색해 citation(knowledge/citation-helper.ts Citation)으로 변환한다.
// NOTE: 업로드 시 parse+chunk+embed 로 ephemeral_chunks 를 채우는 인덱싱 파이프라인은 이
// 태스크 표(app.ts, routes/messages.ts) 밖 — 여기는 이미 적재된 청크를 "검색해 인용"하는
// 소비 측만 담당한다(P14-T3-01 KnowledgeRetrievalPort 와 동일 사유의 범위 분리).
import type { EmbeddingProvider } from "@wchat/interfaces";
import { pgPool } from "./client.js";
import {
  hybridSearch,
  type HybridSearchCandidate,
} from "../knowledge/search-service.js";
import type { Citation } from "../knowledge/citation-helper.js";
import { DEFAULT_ORG_SETTINGS } from "../lib/org-settings-schema.js";

// pgvector 컬럼은 pg 드라이버에 커스텀 타입 파서가 없어 `[0.1,0.2,...]` 텍스트로 돌아온다
// (project-document-data-access.ts 의 toVectorLiteral 과 대칭되는 역변환).
function parseVector(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function createPgAttachmentsPort(deps: {
  embeddingProvider: EmbeddingProvider;
}) {
  return {
    async resolveEphemeralContext(
      uploadId: string,
    ): Promise<{ filename: string } | null> {
      const res = await pgPool.query(
        "SELECT filename FROM uploads WHERE id = $1",
        [uploadId],
      );
      const row = res.rows[0] as { filename: string } | undefined;
      return row ? { filename: row.filename } : null;
    },

    async searchEphemeralChunks(input: {
      sessionId: string;
      uploadIds: string[];
      queryText: string;
    }): Promise<Citation[]> {
      if (input.uploadIds.length === 0) return [];

      const res = await pgPool.query(
        `SELECT ec.chunk_index, ec.page_number, ec.content, ec.embedding, ec.upload_id, u.filename
         FROM ephemeral_chunks ec
         JOIN uploads u ON u.id = ec.upload_id
         WHERE ec.session_id = $1 AND ec.upload_id = ANY($2::uuid[])`,
        [input.sessionId, input.uploadIds],
      );
      if (res.rows.length === 0) return [];

      const [queryEmbedding] = await deps.embeddingProvider.embed(
        [input.queryText],
        { type: "query" },
      );

      const filenameByUploadId = new Map<string, string>();
      // hybridSearch 는 DocumentChunk 형태만 받는다(project 용과 동일 알고리즘 공유) —
      // documentId 필드를 uploadId 별칭으로 재사용해 project_documents 전용 타입을
      // 새로 분기하지 않는다(순수 RRF 알고리즘은 source 를 구분하지 않음).
      const candidates: HybridSearchCandidate[] = res.rows.map((row) => {
        const uploadId = row.upload_id as string;
        filenameByUploadId.set(uploadId, row.filename as string);
        return {
          chunk: {
            id: `${uploadId}:${row.chunk_index}`,
            documentId: uploadId,
            chunkIndex: row.chunk_index as number,
            content: row.content as string,
            tokenCount: null,
            embedding: parseVector(row.embedding),
            metadata:
              row.page_number != null
                ? { pageNumber: row.page_number as number }
                : {},
            createdAt: new Date(),
          },
        };
      });

      const hits = hybridSearch({
        candidates,
        queryEmbedding: queryEmbedding ?? [],
        queryText: input.queryText,
        topK: DEFAULT_ORG_SETTINGS.ragTopK ?? 10,
        rrfK: DEFAULT_ORG_SETTINGS.ragRrfK ?? 60,
      });

      return hits.map((hit, i) => {
        const uploadId = hit.chunk.documentId;
        const pageNumber = hit.chunk.metadata.pageNumber;
        return {
          index: i + 1,
          source: "ephemeral" as const,
          uploadId,
          filename: filenameByUploadId.get(uploadId) ?? "unknown",
          snippet: hit.chunk.content.slice(0, 200),
          ...(typeof pageNumber === "number" ? { page: pageNumber } : {}),
        };
      });
    },
  };
}

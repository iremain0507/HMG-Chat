// knowledge/knowledge-retrieval-pg.ts — KnowledgeRetrievalPort(tools/handlers/knowledge-search-handler.ts)의
//   pg 구현체(P20-T3-02). 인덱싱 생산측(db/document-service.ts)이 이미 project_documents/
//   document_chunks(0005)를 채우므로, 여기는 projectId 로 스코프한 순수 조회만 담당한다 —
//   RRF 랭킹(hybridSearch)/citation 변환은 knowledge-search-handler.ts invoke() 가 수행.
//   project_documents.project_id → projects.org_id 로 이어지는 FK 체인이 이미 org 를 유일하게
//   고정하므로(project 는 한 org 소속), document_chunks 를 project_id 로만 필터해도
//   cross-org 스코프는 자연히 유지된다(다른 org 의 project_id 를 넘겨도 그 project 소속
//   chunk 만 반환 — 남의 org 문서가 섞여 나올 방법이 없다).
import type { DocumentChunk } from "@wchat/interfaces";
import { pgPool } from "../db/client.js";
import type { KnowledgeRetrievalPort } from "../tools/handlers/knowledge-search-handler.js";
import type { CitationSourceMeta } from "./citation-helper.js";
import type { HybridSearchCandidate } from "./search-service.js";

// pgvector 컬럼은 커스텀 타입 파서가 없어 `[0.1,0.2,...]` 텍스트로 돌아온다
// (project-document-data-access.ts 의 toVectorLiteral 과 대칭되는 역변환, ephemeral-chunk-search.ts 와 동일 패턴).
function parseVector(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function toChunk(row: Record<string, unknown>): DocumentChunk {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    chunkIndex: row.chunk_index as number,
    content: row.content as string,
    tokenCount: (row.token_count as number | null) ?? null,
    embedding: parseVector(row.embedding),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Date,
  };
}

export function createKnowledgeRetrievalPgPort(): KnowledgeRetrievalPort {
  return {
    async loadCandidates({ projectId }) {
      if (!projectId) {
        return { candidates: [], sourceMetaByDocumentId: new Map() };
      }

      const res = await pgPool.query(
        `SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.token_count,
                dc.embedding, dc.metadata, dc.created_at, pd.filename
         FROM document_chunks dc
         JOIN project_documents pd ON pd.id = dc.document_id
         WHERE pd.project_id = $1
         ORDER BY dc.document_id, dc.chunk_index ASC`,
        [projectId],
      );

      const sourceMetaByDocumentId = new Map<string, CitationSourceMeta>();
      const candidates: HybridSearchCandidate[] = res.rows.map((row) => {
        const documentId = row.document_id as string;
        if (!sourceMetaByDocumentId.has(documentId)) {
          sourceMetaByDocumentId.set(documentId, {
            source: "project",
            documentId,
            filename: row.filename as string,
          });
        }
        return { chunk: toChunk(row) };
      });

      return { candidates, sourceMetaByDocumentId };
    },
  };
}

// knowledge/knowledge-retrieval-pg.ts — KnowledgeRetrievalPort(tools/handlers/knowledge-search-handler.ts)의
//   pg 구현체(P20-T3-02). 인덱싱 생산측(db/document-service.ts)이 이미 project_documents/
//   document_chunks(0005)를 채우므로, 여기는 project_documents 스코프 조회에 더해
//   세션 ephemeral_chunks(0014) 조회까지 병합한다(P22-T3-01, 계약 16-API §513 —
//   knowledge_search 는 session+project 인덱스를 함께 검색). RRF 랭킹(hybridSearch)/citation
//   변환은 knowledge-search-handler.ts invoke() 가 두 소스가 섞인 candidate 풀 위에서 수행한다.
//   project_documents.project_id → projects.org_id 로 이어지는 FK 체인이 이미 org 를 유일하게
//   고정하므로(project 는 한 org 소속), document_chunks 를 project_id 로만 필터해도
//   cross-org 스코프는 자연히 유지된다(다른 org 의 project_id 를 넘겨도 그 project 소속
//   chunk 만 반환). ephemeral 은 session_id 로만 스코프한다(0014 RLS 와 동일 축).
import type { DocumentChunk } from "@wchat/interfaces";
import { pgPool } from "../db/client.js";
import type { KnowledgeRetrievalPort } from "../tools/handlers/knowledge-search-handler.js";
import type { CitationSourceMeta } from "./citation-helper.js";
import type { HybridSearchCandidate } from "./search-service.js";

// pg Pool.query 의 최소 계약 — 실 배선은 pgPool, 테스트는 주입 executor(병합/태깅 로직만
// 결정론적으로 단언, ephemeral-chunk-search.ts 와 동일한 소비-측 조회 패턴).
export interface PgQueryExecutor {
  query(
    text: string,
    params: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

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

// ephemeral_chunks(0014) 행 → DocumentChunk. hybridSearch 는 DocumentChunk 형태만 받으므로
// documentId 를 upload_id 별칭으로 재사용한다(ephemeral-chunk-search.ts:69-90 와 동일 패턴 —
// 순수 RRF 알고리즘은 source 를 구분하지 않는다). page_number 는 citation 용으로 metadata 에 병합.
function toEphemeralChunk(row: Record<string, unknown>): DocumentChunk {
  const uploadId = row.upload_id as string;
  const chunkIndex = row.chunk_index as number;
  const baseMeta = (row.metadata as Record<string, unknown>) ?? {};
  const pageNumber = row.page_number;
  return {
    id: `${uploadId}:${chunkIndex}`,
    documentId: uploadId,
    chunkIndex,
    content: row.content as string,
    tokenCount: null,
    embedding: parseVector(row.embedding),
    metadata:
      pageNumber != null
        ? { ...baseMeta, pageNumber: pageNumber as number }
        : baseMeta,
    createdAt: (row.created_at as Date) ?? new Date(),
  };
}

export function createKnowledgeRetrievalPgPort(deps?: {
  pool?: PgQueryExecutor;
}): KnowledgeRetrievalPort {
  const pool: PgQueryExecutor = deps?.pool ?? pgPool;
  return {
    async loadCandidates({ projectId, sessionId }) {
      const sourceMetaByDocumentId = new Map<string, CitationSourceMeta>();
      const candidates: HybridSearchCandidate[] = [];

      // 1) project_documents 스코프 조회(projectId 없으면 skip — 계약상 프로젝트 미연결 세션 허용).
      if (projectId) {
        const res = await pool.query(
          `SELECT dc.id, dc.document_id, dc.chunk_index, dc.content, dc.token_count,
                  dc.embedding, dc.metadata, dc.created_at, pd.filename
           FROM document_chunks dc
           JOIN project_documents pd ON pd.id = dc.document_id
           WHERE pd.project_id = $1
           ORDER BY dc.document_id, dc.chunk_index ASC`,
          [projectId],
        );
        for (const row of res.rows) {
          const documentId = row.document_id as string;
          if (!sourceMetaByDocumentId.has(documentId)) {
            sourceMetaByDocumentId.set(documentId, {
              source: "project",
              documentId,
              filename: row.filename as string,
            });
          }
          candidates.push({ chunk: toChunk(row) });
        }
      }

      // 2) 세션 ephemeral_chunks 조회 — session_id 로만 스코프(0014 RLS 와 동일 축).
      //    프로젝트 문서가 없어도 세션 첨부만으로 knowledge_search 가 인용할 수 있어야 한다(계약 §513).
      if (sessionId) {
        const eph = await pool.query(
          `SELECT ec.id, ec.upload_id, ec.chunk_index, ec.page_number, ec.content,
                  ec.embedding, ec.metadata, ec.created_at, u.filename
           FROM ephemeral_chunks ec
           JOIN uploads u ON u.id = ec.upload_id
           WHERE ec.session_id = $1
           ORDER BY ec.upload_id, ec.chunk_index ASC`,
          [sessionId],
        );
        for (const row of eph.rows) {
          const uploadId = row.upload_id as string;
          if (!sourceMetaByDocumentId.has(uploadId)) {
            sourceMetaByDocumentId.set(uploadId, {
              source: "ephemeral",
              uploadId,
              filename: row.filename as string,
            });
          }
          candidates.push({ chunk: toEphemeralChunk(row) });
        }
      }

      return { candidates, sourceMetaByDocumentId };
    },
  };
}

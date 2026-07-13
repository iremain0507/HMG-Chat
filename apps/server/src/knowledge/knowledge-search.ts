// knowledge-search.ts — knowledge_search 도구: hybridSearch 결과를 citation 과 함께 반환.
//   결과가 없으면(모르는 도메인) NO_RESULTS_MESSAGE 로 폴백. 08-SPRINT-PLAN.md Phase 4 gate 단일 출처.
import type { AgentToolSpec } from "@wchat/interfaces";
import { hybridSearch, type HybridSearchCandidate } from "./search-service.js";
import {
  buildCitations,
  NO_RESULTS_MESSAGE,
  type Citation,
  type CitationSourceMeta,
} from "./citation-helper.js";

export const knowledgeSearchToolSpec: AgentToolSpec = {
  name: "knowledge_search",
  description:
    "현재 프로젝트/세션에 첨부된 문서에서 질의와 관련된 내용을 검색해 citation 과 함께 반환한다.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
};

export interface KnowledgeSearchInput {
  candidates: HybridSearchCandidate[];
  sourceMetaByDocumentId: Map<string, CitationSourceMeta>;
  queryEmbedding: number[];
  queryText: string;
  topK: number;
  rrfK: number;
}

export interface KnowledgeSearchResult {
  citations: Citation[];
  message: string | null;
}

export function knowledgeSearch(
  input: KnowledgeSearchInput,
): KnowledgeSearchResult {
  const hits = hybridSearch({
    candidates: input.candidates,
    queryEmbedding: input.queryEmbedding,
    queryText: input.queryText,
    topK: input.topK,
    rrfK: input.rrfK,
  });

  if (hits.length === 0) {
    return { citations: [], message: NO_RESULTS_MESSAGE };
  }

  return {
    citations: buildCitations(hits, input.sourceMetaByDocumentId),
    message: null,
  };
}

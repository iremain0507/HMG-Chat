import { describe, it, expect } from "vitest";
import {
  knowledgeSearch,
  knowledgeSearchToolSpec,
} from "../knowledge-search.js";
import {
  NO_RESULTS_MESSAGE,
  type CitationSourceMeta,
} from "../citation-helper.js";
import type { HybridSearchCandidate } from "../search-service.js";
import type { DocumentChunk } from "@wchat/interfaces";

function makeCandidate(
  documentId: string,
  content: string,
  embedding: number[] | null,
): HybridSearchCandidate {
  const chunk: DocumentChunk = {
    id: `${documentId}-chunk`,
    documentId,
    chunkIndex: 0,
    content,
    tokenCount: content.split(/\s+/).length,
    embedding,
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  return { chunk };
}

describe("knowledgeSearchToolSpec", () => {
  it("AgentToolSpec 계약을 만족한다", () => {
    expect(knowledgeSearchToolSpec.name).toBe("knowledge_search");
    expect(knowledgeSearchToolSpec.permissionTier).toBe("tool");
    expect(knowledgeSearchToolSpec.defaultPolicy).toBe("allow");
  });
});

describe("knowledgeSearch", () => {
  it("검색 결과 각각에 citation 이 100% 매칭된다", () => {
    const candidates = [
      makeCandidate("doc-1", "widget widget widget", [1, 0, 0]),
      makeCandidate("doc-2", "gadget gadget", [0, 1, 0]),
    ];
    const sourceMetaByDocumentId = new Map<string, CitationSourceMeta>([
      ["doc-1", { source: "project", documentId: "doc-1", filename: "a.pdf" }],
      ["doc-2", { source: "project", documentId: "doc-2", filename: "b.pdf" }],
    ]);

    const result = knowledgeSearch({
      candidates,
      sourceMetaByDocumentId,
      queryEmbedding: [1, 0, 0],
      queryText: "widget",
      topK: 10,
      rrfK: 60,
    });

    expect(result.message).toBeNull();
    expect(result.citations).toHaveLength(2);
    result.citations.forEach((c, i) => expect(c.index).toBe(i + 1));
  });

  it("모르는 도메인(빈 결과)이면 관련 문서 없음 메시지를 반환한다", () => {
    const result = knowledgeSearch({
      candidates: [],
      sourceMetaByDocumentId: new Map(),
      queryEmbedding: [1, 0, 0],
      queryText: "아무거나",
      topK: 10,
      rrfK: 60,
    });

    expect(result.citations).toEqual([]);
    expect(result.message).toBe(NO_RESULTS_MESSAGE);
  });
});

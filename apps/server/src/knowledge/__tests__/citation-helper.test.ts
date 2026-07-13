import { describe, it, expect } from "vitest";
import {
  extractCitationIndexes,
  buildCitations,
  matchCitations,
  NO_RESULTS_MESSAGE,
  type CitationSourceMeta,
} from "../citation-helper.js";
import type { DocumentChunk, HybridSearchResult } from "@wchat/interfaces";

function makeHit(
  documentId: string,
  content: string,
  metadata: Record<string, unknown> = {},
): HybridSearchResult {
  const chunk: DocumentChunk = {
    id: `${documentId}-chunk`,
    documentId,
    chunkIndex: 0,
    content,
    tokenCount: content.split(/\s+/).length,
    embedding: null,
    metadata,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  return { chunk, vectorScore: 0.9, bm25Score: 1, rrfScore: 0.5, rank: 1 };
}

describe("extractCitationIndexes", () => {
  it("텍스트의 [N] 마커를 오름차순 유니크로 추출", () => {
    expect(extractCitationIndexes("[1] 텍스트 [2] 그리고 [1] 다시")).toEqual([
      1, 2,
    ]);
  });

  it("마커가 없으면 빈 배열", () => {
    expect(extractCitationIndexes("마커 없는 텍스트")).toEqual([]);
  });
});

describe("buildCitations", () => {
  it("hit 순서대로 1부터 증가하는 index 로 citation 을 만든다", () => {
    const hits = [
      makeHit("doc-1", "widget content"),
      makeHit("doc-2", "gadget content"),
    ];
    const meta = new Map<string, CitationSourceMeta>([
      ["doc-1", { source: "project", documentId: "doc-1", filename: "a.pdf" }],
      ["doc-2", { source: "project", documentId: "doc-2", filename: "b.pdf" }],
    ]);

    const citations = buildCitations(hits, meta);

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      index: 1,
      filename: "a.pdf",
      source: "project",
      documentId: "doc-1",
    });
    expect(citations[1]).toMatchObject({
      index: 2,
      filename: "b.pdf",
      documentId: "doc-2",
    });
  });

  it("metadata.pageNumber 가 number 면 page 로 매핑", () => {
    const hits = [makeHit("doc-1", "content", { pageNumber: 3 })];
    const meta = new Map<string, CitationSourceMeta>([
      ["doc-1", { source: "project", documentId: "doc-1", filename: "a.pdf" }],
    ]);

    const [citation] = buildCitations(hits, meta);
    expect(citation?.page).toBe(3);
  });

  it("source meta 가 없으면 throw", () => {
    const hits = [makeHit("missing", "content")];
    expect(() => buildCitations(hits, new Map())).toThrow();
  });
});

describe("matchCitations", () => {
  it("본문 마커가 모두 citation 에 있으면 allMatched true", () => {
    const citations = buildCitations(
      [makeHit("doc-1", "a"), makeHit("doc-2", "b")],
      new Map<string, CitationSourceMeta>([
        [
          "doc-1",
          { source: "project", documentId: "doc-1", filename: "a.pdf" },
        ],
        [
          "doc-2",
          { source: "project", documentId: "doc-2", filename: "b.pdf" },
        ],
      ]),
    );

    const result = matchCitations("근거는 [1] 과 [2] 이다", citations);
    expect(result.allMatched).toBe(true);
    expect(result.unmatchedIndexes).toEqual([]);
  });

  it("citation 에 없는 마커가 본문에 있으면 unmatchedIndexes 로 보고", () => {
    const citations = buildCitations(
      [makeHit("doc-1", "a")],
      new Map<string, CitationSourceMeta>([
        [
          "doc-1",
          { source: "project", documentId: "doc-1", filename: "a.pdf" },
        ],
      ]),
    );

    const result = matchCitations("근거는 [1] 과 [3] 이다", citations);
    expect(result.allMatched).toBe(false);
    expect(result.unmatchedIndexes).toEqual([3]);
  });
});

describe("NO_RESULTS_MESSAGE", () => {
  it("관련 문서 없음 문자열 상수", () => {
    expect(NO_RESULTS_MESSAGE).toBe("관련 문서 없음");
  });
});

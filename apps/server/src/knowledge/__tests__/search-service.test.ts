import { describe, it, expect } from "vitest";
import {
  cosineSimilarity,
  keywordCountScore,
  hybridSearch,
  type HybridSearchCandidate,
} from "../search-service.js";
import type { DocumentChunk } from "@wchat/interfaces";

function makeChunk(
  id: string,
  content: string,
  embedding: number[] | null,
): DocumentChunk {
  return {
    id,
    documentId: "doc-1",
    chunkIndex: 0,
    content,
    tokenCount: content.split(/\s+/).length,
    embedding,
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("cosineSimilarity", () => {
  it("동일 벡터는 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("직교 벡터는 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("영벡터는 0 (division by zero 방지)", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe("keywordCountScore", () => {
  it("query 키워드 등장 횟수를 카운트", () => {
    expect(keywordCountScore("apple banana apple", "apple")).toBe(2);
  });

  it("여러 키워드는 합산", () => {
    expect(keywordCountScore("apple banana", "apple banana")).toBe(2);
  });

  it("매칭 없으면 0", () => {
    expect(keywordCountScore("apple banana", "cherry")).toBe(0);
  });
});

describe("hybridSearch", () => {
  it("vector·bm25 양쪽 모두 상위인 청크가 RRF 1위", () => {
    const queryEmbedding = [1, 0, 0];
    const candidates: HybridSearchCandidate[] = [
      { chunk: makeChunk("best", "widget widget widget", [1, 0, 0]) }, // top vector + top bm25
      { chunk: makeChunk("vector-only", "irrelevant text", [1, 0, 0]) }, // top vector, bm25 0
      { chunk: makeChunk("bm25-only", "widget widget widget", [0, 1, 0]) }, // orthogonal vector, top bm25
      { chunk: makeChunk("worst", "nothing here", [0, 0, 1]) },
    ];

    const results = hybridSearch({
      candidates,
      queryEmbedding,
      queryText: "widget",
      topK: 10,
      rrfK: 60,
    });

    expect(results[0]?.chunk.id).toBe("best");
    expect(results[0]?.rank).toBe(1);
    expect(results).toHaveLength(4);
    results.forEach((r, i) => expect(r.rank).toBe(i + 1));
  });

  it("topK 로 결과 개수를 제한한다", () => {
    const candidates: HybridSearchCandidate[] = Array.from(
      { length: 5 },
      (_, i) => ({ chunk: makeChunk(`c${i}`, `word${i}`, [i, 1, 0]) }),
    );

    const results = hybridSearch({
      candidates,
      queryEmbedding: [1, 0, 0],
      queryText: "word",
      topK: 2,
      rrfK: 60,
    });

    expect(results).toHaveLength(2);
  });

  it("각 결과는 vectorScore/bm25Score/rrfScore 를 포함한다", () => {
    const candidates: HybridSearchCandidate[] = [
      { chunk: makeChunk("a", "widget", [1, 0, 0]) },
    ];

    const [result] = hybridSearch({
      candidates,
      queryEmbedding: [1, 0, 0],
      queryText: "widget",
      topK: 10,
      rrfK: 60,
    });

    expect(result?.vectorScore).toBeCloseTo(1);
    expect(result?.bm25Score).toBe(1);
    expect(result?.rrfScore).toBeGreaterThan(0);
  });

  it("embedding 이 null 인 청크는 vectorScore 0 으로 처리", () => {
    const candidates: HybridSearchCandidate[] = [
      { chunk: makeChunk("no-embedding", "widget", null) },
    ];

    const [result] = hybridSearch({
      candidates,
      queryEmbedding: [1, 0, 0],
      queryText: "widget",
      topK: 10,
      rrfK: 60,
    });

    expect(result?.vectorScore).toBe(0);
  });
});

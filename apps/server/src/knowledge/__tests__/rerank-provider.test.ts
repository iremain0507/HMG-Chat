import { describe, it, expect } from "vitest";
import type { DocumentChunk, HybridSearchResult } from "@wchat/interfaces";
import {
  applyRerank,
  createDevStubRerankProvider,
  type RerankProvider,
} from "../rerank-provider.js";

function chunk(id: string, content: string): DocumentChunk {
  return {
    id: `${id}-chunk`,
    documentId: id,
    chunkIndex: 0,
    content,
    tokenCount: 4,
    embedding: [1, 0, 0],
    metadata: {},
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function hit(
  id: string,
  content: string,
  rrfScore: number,
): HybridSearchResult {
  return {
    chunk: chunk(id, content),
    vectorScore: 0,
    bm25Score: 0,
    rrfScore,
    rank: 0,
  };
}

describe("createDevStubRerankProvider", () => {
  it("결정론적이다 — 같은 입력은 같은 점수를 반환한다", async () => {
    const reranker = createDevStubRerankProvider();
    const docs = ["widget 사용법", "다른 내용", "widget widget 설명"];
    const a = await reranker.rerank("widget", docs);
    const b = await reranker.rerank("widget", docs);
    expect(a).toEqual(b);
  });

  it("query 용어 overlap 이 높은 문서에 더 높은 점수를 준다", async () => {
    const reranker = createDevStubRerankProvider();
    const scores = await reranker.rerank("widget 사용법", [
      "widget 사용법 상세", // overlap 2
      "widget 만 언급", // overlap 1
    ]);
    const byIndex = new Map(scores.map((s) => [s.index, s.score]));
    expect((byIndex.get(0) ?? 0) > (byIndex.get(1) ?? 0)).toBe(true);
  });

  it("query 용어와 overlap 이 전혀 없는 문서는 prune(제외)한다", async () => {
    const reranker = createDevStubRerankProvider();
    const scores = await reranker.rerank("widget", [
      "widget 관련 문서",
      "전혀 무관한 텍스트",
    ]);
    expect(scores.map((s) => s.index)).toEqual([0]);
  });
});

describe("applyRerank", () => {
  it("RRF 순서가 아니라 reranker 점수 순서로 재정렬한다", async () => {
    // RRF 순서: A(0.9) > B(0.5) > C(0.1)
    const hits = [
      hit("A", "aaa", 0.9),
      hit("B", "bbb", 0.5),
      hit("C", "ccc", 0.1),
    ];
    // reranker 는 C > A > B 순서를 선호
    const reranker: RerankProvider = {
      name: "fake",
      async rerank(_q, docs) {
        const scoreByContent: Record<string, number> = {
          aaa: 0.4,
          bbb: 0.1,
          ccc: 0.9,
        };
        return docs.map((d, index) => ({
          index,
          score: scoreByContent[d] ?? 0,
        }));
      },
    };
    const out = await applyRerank({ query: "q", hits, reranker, topK: 10 });
    expect(out.map((h) => h.chunk.documentId)).toEqual(["C", "A", "B"]);
    // rank 는 1..N 로 재부여
    expect(out.map((h) => h.rank)).toEqual([1, 2, 3]);
  });

  it("reranker 가 자체 cut 아래를 prune 하면 살아남은 문서만 남는다", async () => {
    const hits = [hit("A", "aaa", 0.9), hit("B", "bbb", 0.5)];
    const reranker: RerankProvider = {
      name: "fake",
      async rerank(_q, docs) {
        // B(index 1) 만 반환 = A 는 cut 아래로 prune
        return docs
          .map((_d, index) => ({ index, score: index === 1 ? 0.8 : 0 }))
          .filter((s) => s.score > 0);
      },
    };
    const out = await applyRerank({ query: "q", hits, reranker, topK: 10 });
    expect(out.map((h) => h.chunk.documentId)).toEqual(["B"]);
    expect(out[0]?.rank).toBe(1);
  });

  it("topK 로 재slice 한다", async () => {
    const hits = [
      hit("A", "aaa", 0.9),
      hit("B", "bbb", 0.5),
      hit("C", "ccc", 0.1),
    ];
    const reranker: RerankProvider = {
      name: "fake",
      async rerank(_q, docs) {
        return docs.map((_d, index) => ({ index, score: 1 - index * 0.1 }));
      },
    };
    const out = await applyRerank({ query: "q", hits, reranker, topK: 2 });
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.chunk.documentId)).toEqual(["A", "B"]);
  });

  it("hits 가 비면 그대로 빈 배열을 반환한다", async () => {
    const reranker = createDevStubRerankProvider();
    const out = await applyRerank({ query: "q", hits: [], reranker, topK: 10 });
    expect(out).toEqual([]);
  });
});

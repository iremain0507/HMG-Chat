// search-service.ts — hybrid search: vector(cosine similarity) + bm25(단순 keyword count 근사) + RRF 결합.
//   09-TDD-GUIDE.md 부록A "documentChunks.hybridSearch(...)" 행동 명세(벡터=cosine similarity,
//   bm25=단순 keyword count, RRF 결합) 단일 출처. 14-INTERFACES HybridSearchResult 형태로 반환.
import type { DocumentChunk, HybridSearchResult } from "@wchat/interfaces";

export interface HybridSearchCandidate {
  chunk: DocumentChunk;
}

export interface HybridSearchInput {
  candidates: HybridSearchCandidate[];
  queryEmbedding: number[];
  queryText: string;
  topK: number;
  rrfK: number;
  // org_settings.ragRelevanceThreshold(P14) — post-RRF 필터. 0 이하(기본값 0.0)면 미필터(기존 동작 불변).
  relevanceThreshold?: number;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function keywordCountScore(content: string, queryText: string): number {
  const terms = queryText.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const lower = content.toLowerCase();
  return terms.reduce((sum, term) => sum + lower.split(term).length - 1, 0);
}

function rankOf(
  candidates: HybridSearchCandidate[],
  scoreOf: (c: HybridSearchCandidate) => number,
): Map<HybridSearchCandidate, number> {
  const sorted = [...candidates]
    .map((c, idx) => ({ c, score: scoreOf(c), idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);
  const ranks = new Map<HybridSearchCandidate, number>();
  sorted.forEach((entry, i) => ranks.set(entry.c, i + 1));
  return ranks;
}

export function hybridSearch(input: HybridSearchInput): HybridSearchResult[] {
  const {
    candidates,
    queryEmbedding,
    queryText,
    topK,
    rrfK,
    relevanceThreshold,
  } = input;

  const vectorScores = new Map<HybridSearchCandidate, number>();
  const bm25Scores = new Map<HybridSearchCandidate, number>();
  for (const c of candidates) {
    vectorScores.set(
      c,
      c.chunk.embedding
        ? cosineSimilarity(c.chunk.embedding, queryEmbedding)
        : 0,
    );
    bm25Scores.set(c, keywordCountScore(c.chunk.content, queryText));
  }

  const vectorRanks = rankOf(candidates, (c) => vectorScores.get(c) ?? 0);
  const bm25Ranks = rankOf(candidates, (c) => bm25Scores.get(c) ?? 0);

  const scored = candidates.map((c) => ({
    chunk: c.chunk,
    vectorScore: vectorScores.get(c) ?? 0,
    bm25Score: bm25Scores.get(c) ?? 0,
    rrfScore:
      1 / (rrfK + (vectorRanks.get(c) ?? candidates.length)) +
      1 / (rrfK + (bm25Ranks.get(c) ?? candidates.length)),
  }));

  scored.sort((a, b) => b.rrfScore - a.rrfScore);

  const filtered =
    relevanceThreshold && relevanceThreshold > 0
      ? scored.filter((r) => r.vectorScore >= relevanceThreshold)
      : scored;

  return filtered.slice(0, topK).map((r, i) => ({ ...r, rank: i + 1 }));
}

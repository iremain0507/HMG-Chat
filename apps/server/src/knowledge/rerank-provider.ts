// rerank-provider.ts — hybridSearch(RRF) 이후 선택적으로 적용하는 cross-encoder reranking 단계.
//   Open WebUI 의 advanced reranking(검색 후보를 query-문서 relevance 로 재정렬)을 참조하되,
//   embedding-provider.ts 와 동일하게 LOCAL 포트로 정의해 packages/interfaces(FROZEN)를 건드리지 않는다.
//   실 cross-encoder 모델(BGE-reranker 등)은 배포 시 이 포트 구현체로 교체한다.
import type { HybridSearchResult } from "@wchat/interfaces";

// reranker 가 산출한 문서별 relevance 점수. index 는 rerank() 에 넘긴 documents 배열의 인덱스.
export interface RerankScore {
  index: number;
  score: number;
}

// LOCAL RerankProvider 포트. rerank() 는 query 대비 각 문서의 relevance 를 점수화하고,
// 자체 relevance cut 아래 문서는 결과에서 제외(prune)할 수 있다(반환 길이 < documents 길이 허용).
export interface RerankProvider {
  name: string;
  rerank(
    query: string,
    documents: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<RerankScore[]>;
}

export interface ApplyRerankInput {
  query: string;
  hits: HybridSearchResult[];
  reranker: RerankProvider;
  topK: number;
  signal?: AbortSignal;
}

// hybridSearch(RRF) 결과 hits 를 reranker 점수 순서로 재정렬/prune 후 topK 로 자르고 rank 를 1..N 로 재부여.
// reranker 가 반환하지 않은(=cut 아래) 문서는 제외된다. hits 가 비면 그대로 반환(호출 no-op).
export async function applyRerank(
  input: ApplyRerankInput,
): Promise<HybridSearchResult[]> {
  const { query, hits, reranker, topK, signal } = input;
  if (hits.length === 0) return hits;

  const scores = await reranker.rerank(
    query,
    hits.map((h) => h.chunk.content),
    signal ? { signal } : undefined,
  );

  return scores
    .slice()
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((s) => hits[s.index])
    .filter((h): h is HybridSearchResult => h !== undefined)
    .slice(0, topK)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

/**
 * 결정론적 dev RerankProvider. LOCAL_ONLY 환경엔 실 cross-encoder 모델이 없으므로,
 * query 용어 overlap 비율(coverage)로 relevance 를 근사한다. 같은 입력 → 같은 점수(재현성),
 * overlap 이 전혀 없는 문서는 cut 으로 prune. 실제 semantic 품질은 배포 시 실 모델로 교체.
 * @param name 리포트/로그용 식별자 (기본 'dev-stub-rerank')
 */
export function createDevStubRerankProvider(
  name = "dev-stub-rerank",
): RerankProvider {
  return {
    name,
    async rerank(query, documents, opts) {
      opts?.signal?.throwIfAborted?.();
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const termCount = terms.length || 1;
      return documents
        .map((doc, index) => {
          const lower = doc.toLowerCase();
          const overlap = terms.reduce(
            (sum, t) => sum + (lower.includes(t) ? 1 : 0),
            0,
          );
          return { index, score: overlap / termCount };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index);
    },
  };
}

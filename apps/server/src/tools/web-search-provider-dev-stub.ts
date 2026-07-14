// web-search-provider-dev-stub.ts — 로컬 dev/테스트용 in-memory WebSearchPort.
//   LOCAL_ONLY 환경엔 실 Tavily API 키가 없으므로, 외부 네트워크 호출 없이 결정론적 결과를
//   반환한다. fixtures 로 query→결과를 주입할 수 있고, 미등록 query 는 결정론적 synthetic
//   결과(같은 query → 같은 결과)로 폴백해 임의 query 로도 tool_result 왕복을 테스트할 수 있다.
//   embedding-provider-dev-stub.ts 와 동일한 "실 provider 는 배포 시 교체" 원칙.
import type { WebSearchPort, WebSearchResultItem } from "./web-search-port.js";

export function createDevStubWebSearchProvider(
  fixtures?: Map<string, WebSearchResultItem[]>,
): WebSearchPort {
  return {
    async search(query, opts) {
      opts?.signal?.throwIfAborted?.();
      const maxResults = opts?.maxResults ?? 5;
      const fixed = fixtures?.get(query);
      const results: WebSearchResultItem[] = fixed ?? [
        {
          title: `dev-stub result for "${query}"`,
          url: `https://example.com/dev-stub-search?q=${encodeURIComponent(query)}`,
          content: `deterministic dev-stub content for query: ${query}`,
          score: 1,
        },
      ];
      return results.slice(0, maxResults);
    },
  };
}

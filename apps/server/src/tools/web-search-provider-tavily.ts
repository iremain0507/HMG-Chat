// web-search-provider-tavily.ts — Tavily REST 기반 WebSearchPort 구현(실 provider).
//   SDK 미도입(계획상 "tavily 또는 REST" 허용 — 신규 dependency 없이 native fetch 로 REST 호출).
//   LOCAL_ONLY 세션엔 실 TAVILY_API_KEY 가 없어 테스트는 fetchImpl 을 fake 로 주입해 검증하고,
//   배포 시 app.ts 가 실 apiKey 로 이 provider 를 조립한다(web-search-provider-dev-stub.ts 대체).
import type { WebSearchPort, WebSearchResultItem } from "./web-search-port.js";

interface TavilySearchResponseItem {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilySearchResponse {
  results?: TavilySearchResponseItem[];
}

export interface CreateTavilyWebSearchProviderDeps {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createTavilyWebSearchProvider(
  deps: CreateTavilyWebSearchProviderDeps,
): WebSearchPort {
  const baseUrl = deps.baseUrl ?? "https://api.tavily.com";
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    async search(query, opts) {
      const res = await fetchImpl(`${baseUrl}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: deps.apiKey,
          query,
          max_results: opts?.maxResults ?? 5,
        }),
        ...(opts?.signal ? { signal: opts.signal } : {}),
      });

      if (!res.ok) {
        throw new Error(
          `Tavily search failed: ${res.status} ${res.statusText}`,
        );
      }

      const data = (await res.json()) as TavilySearchResponse;
      const items: WebSearchResultItem[] = (data.results ?? []).map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.content ?? "",
        ...(typeof r.score === "number" ? { score: r.score } : {}),
      }));
      return items;
    },
  };
}

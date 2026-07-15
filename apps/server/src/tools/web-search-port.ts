// web-search-port.ts — 서버-로컬 웹검색 포트(20-MULTI-AGENT-TOOL.md §20.4-2 포트-어댑터 원칙).
//   packages/interfaces 에는 두지 않는다(동결 계약 아님, web_search 는 apps/server 내부 기능).
//   실 구현 = web-search-provider-tavily.ts(배포 시 API 키 주입), 테스트/LOCAL_ONLY 는
//   web-search-provider-dev-stub.ts(in-memory) 주입 — embedding-provider-dev-stub.ts 와 동일 패턴.

export interface WebSearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface WebSearchPort {
  search(
    query: string,
    opts?: { maxResults?: number; signal?: AbortSignal },
  ): Promise<WebSearchResultItem[]>;
}

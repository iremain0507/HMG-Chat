import { describe, it, expect, vi } from "vitest";
import { createTavilyWebSearchProvider } from "../web-search-provider-tavily.js";

function fakeFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: unknown;
}): typeof fetch {
  return vi.fn(async () => {
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      statusText: response.statusText ?? "",
      json: async () => response.json,
    } as Response;
  }) as unknown as typeof fetch;
}

describe("createTavilyWebSearchProvider", () => {
  it("Tavily REST 응답을 WebSearchResultItem[] 로 정규화한다", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: {
        results: [
          {
            title: "Anthropic",
            url: "https://anthropic.com",
            content: "AI safety company",
            score: 0.9,
          },
        ],
      },
    });
    const port = createTavilyWebSearchProvider({
      apiKey: "test-key",
      fetchImpl,
    });

    const results = await port.search("anthropic");

    expect(results).toEqual([
      {
        title: "Anthropic",
        url: "https://anthropic.com",
        content: "AI safety company",
        score: 0.9,
      },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      api_key: "test-key",
      query: "anthropic",
      max_results: 5,
    });
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const port = createTavilyWebSearchProvider({
      apiKey: "test-key",
      fetchImpl: fakeFetch({ ok: true, json: {} }),
    });
    const results = await port.search("no-hits");
    expect(results).toEqual([]);
  });

  it("HTTP 오류 응답이면 throw 한다", async () => {
    const port = createTavilyWebSearchProvider({
      apiKey: "test-key",
      fetchImpl: fakeFetch({ ok: false, status: 500, statusText: "Error" }),
    });
    await expect(port.search("q")).rejects.toThrow(/Tavily/);
  });
});

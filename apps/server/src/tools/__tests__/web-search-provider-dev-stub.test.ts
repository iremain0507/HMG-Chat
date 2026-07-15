import { describe, it, expect } from "vitest";
import { createDevStubWebSearchProvider } from "../web-search-provider-dev-stub.js";
import type { WebSearchResultItem } from "../web-search-port.js";

describe("createDevStubWebSearchProvider", () => {
  it("fixtures 에 없는 query 는 결정론적 synthetic 결과를 반환한다(같은 query→같은 결과)", async () => {
    const port = createDevStubWebSearchProvider();
    const a = await port.search("wchat orchestrator");
    const b = await port.search("wchat orchestrator");
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(a[0]?.title).toContain("wchat orchestrator");
    expect(a[0]?.url).toMatch(/^https:\/\//);
  });

  it("fixtures 에 등록된 query 는 해당 결과를 반환한다", async () => {
    const fixed: WebSearchResultItem[] = [
      { title: "Anthropic", url: "https://anthropic.com", content: "..." },
    ];
    const port = createDevStubWebSearchProvider(
      new Map([["anthropic", fixed]]),
    );
    const results = await port.search("anthropic");
    expect(results).toEqual(fixed);
  });

  it("maxResults 로 결과 개수를 제한한다", async () => {
    const fixed: WebSearchResultItem[] = [
      { title: "a", url: "https://a.example", content: "a" },
      { title: "b", url: "https://b.example", content: "b" },
      { title: "c", url: "https://c.example", content: "c" },
    ];
    const port = createDevStubWebSearchProvider(new Map([["q", fixed]]));
    const results = await port.search("q", { maxResults: 2 });
    expect(results).toHaveLength(2);
  });

  it("이미 abort 된 signal 이면 throw 한다", async () => {
    const port = createDevStubWebSearchProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(
      port.search("q", { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

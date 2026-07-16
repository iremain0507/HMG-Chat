import { describe, it, expect } from "vitest";
import type { ToolContext } from "@wchat/interfaces";
import { createWebSearchTool } from "../web-search-handler.js";
import type { WebSearchPort } from "../../web-search-port.js";

function fakeToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const logger: ToolContext["logger"] = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  };
  return {
    requestId: "req-1",
    userId: "user-1",
    orgId: "org-1",
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger,
    hitl: {
      async askApproval() {
        return { kind: "approved" };
      },
    },
    budget: {
      async claim() {},
      async settle() {},
      async refund() {},
      remaining: Infinity,
    },
    ...overrides,
  };
}

describe("createWebSearchTool", () => {
  it("spec 은 web_search 계약(allow policy + read-only/idempotent/web tags)을 만족한다", () => {
    const tool = createWebSearchTool({
      port: {
        async search() {
          return [];
        },
      },
    });

    expect(tool.spec.name).toBe("web_search");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(
      expect.arrayContaining(["read-only", "idempotent", "web"]),
    );
  });

  it("query 검색 결과를 tool_result json 으로 반환한다", async () => {
    const port: WebSearchPort = {
      async search(query) {
        return [
          {
            title: `result for ${query}`,
            url: "https://example.com",
            content: "snippet",
          },
        ];
      },
    };
    const tool = createWebSearchTool({ port });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { query: "wchat" },
      ctx: fakeToolContext(),
    });

    expect(result.toolCallId).toBe("call-1");
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toEqual({
        query: "wchat",
        results: [
          {
            title: "result for wchat",
            url: "https://example.com",
            content: "snippet",
          },
        ],
        citations: [
          {
            index: 1,
            source: "ephemeral",
            filename: "example.com",
            title: "result for wchat",
            sourceUri: "https://example.com",
            snippet: "snippet",
          },
        ],
      });
    }
  });

  it("검색 결과가 여러 개면 citations 를 1부터 순서대로 부여한다", async () => {
    const port: WebSearchPort = {
      async search() {
        return [
          {
            title: "first",
            url: "https://a.example.com/x",
            content: "a".repeat(250),
          },
          {
            title: "second",
            url: "https://b.example.com/y",
            content: "second content",
          },
        ];
      },
    };
    const tool = createWebSearchTool({ port });

    const result = await tool.invoke({
      toolCallId: "call-5",
      args: { query: "wchat" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      const data = result.content.data;
      expect(data.citations).toEqual([
        {
          index: 1,
          source: "ephemeral",
          filename: "a.example.com",
          title: "first",
          sourceUri: "https://a.example.com/x",
          snippet: "a".repeat(200),
        },
        {
          index: 2,
          source: "ephemeral",
          filename: "b.example.com",
          title: "second",
          sourceUri: "https://b.example.com/y",
          snippet: "second content",
        },
      ]);
    }
  });

  it("검색 결과가 없으면 citations 빈 배열을 반환한다", async () => {
    const port: WebSearchPort = {
      async search() {
        return [];
      },
    };
    const tool = createWebSearchTool({ port });

    const result = await tool.invoke({
      toolCallId: "call-6",
      args: { query: "wchat" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toEqual({
        query: "wchat",
        results: [],
        citations: [],
      });
    }
  });

  it("query 가 비어있으면 INVALID_INPUT 에러를 반환하고 port.search 를 호출하지 않는다", async () => {
    let called = false;
    const port: WebSearchPort = {
      async search() {
        called = true;
        return [];
      },
    };
    const tool = createWebSearchTool({ port });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { query: "   " },
      ctx: fakeToolContext(),
    });

    expect(called).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("port.search 가 실패하면(abort 아님) WEB_SEARCH_FAILED 에러로 감싸 반환한다", async () => {
    const port: WebSearchPort = {
      async search() {
        throw new Error("network down");
      },
    };
    const tool = createWebSearchTool({ port });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { query: "wchat" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("WEB_SEARCH_FAILED");
      expect(result.content.error.retryable).toBe(true);
    }
  });

  it("abort 된 signal 이면 error 로 감싸지 않고 그대로 throw 한다", async () => {
    const controller = new AbortController();
    const port: WebSearchPort = {
      async search() {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    };
    const tool = createWebSearchTool({ port });

    await expect(
      tool.invoke({
        toolCallId: "call-4",
        args: { query: "wchat" },
        ctx: fakeToolContext({ signal: controller.signal }),
      }),
    ).rejects.toThrow();
  });

  describe("P19-T1-12: org 설정 provider 동적 resolve", () => {
    const fallbackPort: WebSearchPort = {
      async search(query) {
        return [
          {
            title: `fallback:${query}`,
            url: "https://fallback.example.com",
            content: "fallback",
          },
        ];
      },
    };
    const orgPort: WebSearchPort = {
      async search(query) {
        return [
          {
            title: `org-provider:${query}`,
            url: "https://org.example.com",
            content: "org",
          },
        ];
      },
    };

    it("org settings.webSearchProvider=X 이면 resolveProvider 가 만든 provider(X) 로 검색한다(L1 last-mile)", async () => {
      const tool = createWebSearchTool({
        port: fallbackPort,
        settings: {
          async resolve(orgId: string) {
            expect(orgId).toBe("org-1");
            return {
              webSearchProvider: "tavily",
              webSearchEndpoint: "",
              webSearchApiKeyRef: "TAVILY_API_KEY",
            };
          },
        },
        resolveProvider(input) {
          expect(input).toEqual({
            provider: "tavily",
            endpoint: "",
            apiKeyRef: "TAVILY_API_KEY",
          });
          return orgPort;
        },
      });

      const result = await tool.invoke({
        toolCallId: "call-provider-1",
        args: { query: "wchat" },
        ctx: fakeToolContext(),
      });

      expect(result.content.kind).toBe("json");
      if (result.content.kind === "json") {
        expect(result.content.data.results).toEqual([
          {
            title: "org-provider:wchat",
            url: "https://org.example.com",
            content: "org",
          },
        ]);
      }
    });

    it("org settings.webSearchProvider='dev-stub'(미설정)이면 resolveProvider 가 undefined 반환 → deps.port(폴백)로 검색한다", async () => {
      const tool = createWebSearchTool({
        port: fallbackPort,
        settings: {
          async resolve() {
            return {
              webSearchProvider: "dev-stub",
              webSearchEndpoint: "",
              webSearchApiKeyRef: "",
            };
          },
        },
        resolveProvider() {
          return undefined;
        },
      });

      const result = await tool.invoke({
        toolCallId: "call-provider-2",
        args: { query: "wchat" },
        ctx: fakeToolContext(),
      });

      expect(result.content.kind).toBe("json");
      if (result.content.kind === "json") {
        expect(result.content.data.results).toEqual([
          {
            title: "fallback:wchat",
            url: "https://fallback.example.com",
            content: "fallback",
          },
        ]);
      }
    });

    it("settings.resolve 가 실패하면 throw 하지 않고 deps.port(폴백)로 검색한다(L2/L5 fail-soft)", async () => {
      const tool = createWebSearchTool({
        port: fallbackPort,
        settings: {
          async resolve() {
            throw new Error("settings service down");
          },
        },
        resolveProvider() {
          return orgPort;
        },
      });

      const result = await tool.invoke({
        toolCallId: "call-provider-3",
        args: { query: "wchat" },
        ctx: fakeToolContext(),
      });

      expect(result.content.kind).toBe("json");
      if (result.content.kind === "json") {
        expect(result.content.data.results).toEqual([
          {
            title: "fallback:wchat",
            url: "https://fallback.example.com",
            content: "fallback",
          },
        ]);
      }
    });

    it("settings/resolveProvider 가 미주입이면(비파괴) 기존처럼 deps.port 로 검색한다", async () => {
      const tool = createWebSearchTool({ port: fallbackPort });

      const result = await tool.invoke({
        toolCallId: "call-provider-4",
        args: { query: "wchat" },
        ctx: fakeToolContext(),
      });

      expect(result.content.kind).toBe("json");
      if (result.content.kind === "json") {
        expect(result.content.data.results).toEqual([
          {
            title: "fallback:wchat",
            url: "https://fallback.example.com",
            content: "fallback",
          },
        ]);
      }
    });
  });
});

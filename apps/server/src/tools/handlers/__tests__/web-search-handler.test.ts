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
});

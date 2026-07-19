import { describe, it, expect } from "vitest";
import type { ToolContext } from "@wchat/interfaces";
import { createWebFetchTool } from "../web-fetch-handler.js";

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

function htmlResponse(body: string, contentType = "text/html; charset=utf-8") {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "content-type" ? contentType : null,
    },
    async text() {
      return body;
    },
  } as unknown as Response;
}

describe("createWebFetchTool", () => {
  it("spec 은 web_fetch 계약(allow policy + read-only/web tags + url 입력)을 만족한다", () => {
    const tool = createWebFetchTool({
      async fetchImpl() {
        return htmlResponse("<html></html>");
      },
    });

    expect(tool.spec.name).toBe("web_fetch");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(
      expect.arrayContaining(["read-only", "web"]),
    );
    expect(tool.spec.inputSchema.required).toContain("url");
  });

  it("공개 URL 을 fetch·정제해 {url,title,content}+citation 을 tool_result json 으로 반환한다", async () => {
    const page = `<!doctype html><html><head><title>  Example Page  </title>
      <style>.x{color:red}</style></head>
      <body><script>var a=1;</script><h1>Hello</h1><p>World body text.</p></body></html>`;
    let fetched: string | undefined;
    const tool = createWebFetchTool({
      nodeEnv: "test",
      async resolveHostname() {
        return ["93.184.216.34"];
      },
      async fetchImpl(url) {
        fetched = String(url);
        return htmlResponse(page);
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { url: "https://example.com/a" },
      ctx: fakeToolContext(),
    });

    expect(fetched).toBe("https://example.com/a");
    expect(result.toolCallId).toBe("call-1");
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      const data = result.content.data;
      expect(data.url).toBe("https://example.com/a");
      expect(data.title).toBe("Example Page");
      // script/style stripped, tags removed, main text kept
      expect(data.content).toContain("Hello");
      expect(data.content).toContain("World body text.");
      expect(data.content).not.toContain("var a=1");
      expect(data.content).not.toContain("color:red");
      expect(data.citations).toEqual([
        {
          index: 1,
          source: "ephemeral",
          filename: "example.com",
          title: "Example Page",
          sourceUri: "https://example.com/a",
          snippet: expect.any(String),
        },
      ]);
    }
  });

  it("내부/링크로컬 IP(10.0.0.1) 로 해석되는 URL 은 fetch 이전에 INTERNAL_IP_FORBIDDEN 으로 거부한다(SSRF)", async () => {
    let fetched = false;
    const tool = createWebFetchTool({
      nodeEnv: "test",
      async resolveHostname() {
        return ["10.0.0.1"];
      },
      async fetchImpl() {
        fetched = true;
        return htmlResponse("<html></html>");
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { url: "http://internal.example.com" },
      ctx: fakeToolContext(),
    });

    expect(fetched).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INTERNAL_IP_FORBIDDEN");
      expect(result.content.error.retryable).toBe(false);
    }
  });

  it("url 이 비어있으면 INVALID_INPUT 을 반환하고 fetch 하지 않는다", async () => {
    let fetched = false;
    const tool = createWebFetchTool({
      async fetchImpl() {
        fetched = true;
        return htmlResponse("<html></html>");
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { url: "   " },
      ctx: fakeToolContext(),
    });

    expect(fetched).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("HTML 이 아닌 content-type 이면 UNSUPPORTED_CONTENT_TYPE 에러를 반환한다", async () => {
    const tool = createWebFetchTool({
      nodeEnv: "test",
      async resolveHostname() {
        return ["93.184.216.34"];
      },
      async fetchImpl() {
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/octet-stream" },
          async text() {
            return "binary";
          },
        } as unknown as Response;
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: { url: "https://example.com/file.bin" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
    }
  });

  it("fetch 가 실패하면(abort 아님) WEB_FETCH_FAILED(retryable) 로 감싼다", async () => {
    const tool = createWebFetchTool({
      nodeEnv: "test",
      async resolveHostname() {
        return ["93.184.216.34"];
      },
      async fetchImpl() {
        throw new Error("network down");
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-5",
      args: { url: "https://example.com" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("WEB_FETCH_FAILED");
      expect(result.content.error.retryable).toBe(true);
    }
  });

  it("abort 된 signal 이면 error 로 감싸지 않고 그대로 throw 한다", async () => {
    const controller = new AbortController();
    const tool = createWebFetchTool({
      nodeEnv: "test",
      async resolveHostname() {
        return ["93.184.216.34"];
      },
      async fetchImpl() {
        controller.abort();
        throw new DOMException("Aborted", "AbortError");
      },
    });

    await expect(
      tool.invoke({
        toolCallId: "call-6",
        args: { url: "https://example.com" },
        ctx: fakeToolContext({ signal: controller.signal }),
      }),
    ).rejects.toThrow();
  });
});

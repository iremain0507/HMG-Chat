import { describe, it, expect } from "vitest";
import type { EmbeddingProvider, ToolContext } from "@wchat/interfaces";
import {
  createKnowledgeSearchTool,
  type KnowledgeRetrievalPort,
} from "../knowledge-search-handler.js";

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

function fakeEmbeddingProvider(vector: number[]): EmbeddingProvider {
  return {
    name: "fake-embed",
    dim: vector.length,
    async embed(input) {
      return input.map(() => vector);
    },
  };
}

describe("createKnowledgeSearchTool", () => {
  it("spec 은 knowledge_search 계약을 만족한다", () => {
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: {
        async loadCandidates() {
          return { candidates: [], sourceMetaByDocumentId: new Map() };
        },
      },
    });

    expect(tool.spec.name).toBe("knowledge_search");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
  });

  it("검색 결과가 있으면 index/filename/snippet 갖춘 citations 를 json 결과로 반환한다", async () => {
    const retrieval: KnowledgeRetrievalPort = {
      async loadCandidates() {
        return {
          candidates: [
            {
              chunk: {
                id: "doc-1-chunk",
                documentId: "doc-1",
                chunkIndex: 0,
                content: "widget widget widget 사용법 설명입니다",
                tokenCount: 5,
                embedding: [1, 0, 0],
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            },
          ],
          sourceMetaByDocumentId: new Map([
            [
              "doc-1",
              {
                source: "project" as const,
                documentId: "doc-1",
                filename: "widget-guide.pdf",
              },
            ],
          ]),
        };
      },
    };
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval,
    });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { query: "widget 사용법" },
      ctx: fakeToolContext(),
    });

    expect(result.toolCallId).toBe("call-1");
    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      citations: Array<{ index: number; filename: string; snippet: string }>;
      message: string | null;
    };
    expect(data.message).toBeNull();
    expect(data.citations).toHaveLength(1);
    expect(data.citations[0]).toMatchObject({
      index: 1,
      filename: "widget-guide.pdf",
    });
    expect(typeof data.citations[0]?.snippet).toBe("string");
    expect(data.citations[0]?.snippet.length).toBeGreaterThan(0);
  });

  it("빈 query 는 error content 를 반환한다", async () => {
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: {
        async loadCandidates() {
          return { candidates: [], sourceMetaByDocumentId: new Map() };
        },
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { query: "   " },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
  });

  it("검색 결과가 없으면 빈 citations + 안내 메시지를 반환한다", async () => {
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: {
        async loadCandidates() {
          return { candidates: [], sourceMetaByDocumentId: new Map() };
        },
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { query: "아무거나" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      citations: unknown[];
      message: string | null;
    };
    expect(data.citations).toEqual([]);
    expect(typeof data.message).toBe("string");
  });
});

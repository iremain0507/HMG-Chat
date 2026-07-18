import { describe, it, expect } from "vitest";
import type { EmbeddingProvider, ToolContext } from "@wchat/interfaces";
import {
  createKnowledgeSearchTool,
  type KnowledgeRetrievalPort,
  type KnowledgeSearchSettingsPort,
} from "../knowledge-search-handler.js";
import { DEFAULT_ORG_SETTINGS } from "../../../lib/org-settings-schema.js";

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

  function manyCandidates(count: number): KnowledgeRetrievalPort {
    return {
      async loadCandidates() {
        const sourceMetaByDocumentId = new Map();
        const candidates = Array.from({ length: count }, (_, i) => {
          const documentId = `doc-${i}`;
          sourceMetaByDocumentId.set(documentId, {
            source: "project" as const,
            documentId,
            filename: `doc-${i}.pdf`,
          });
          return {
            chunk: {
              id: `doc-${i}-chunk`,
              documentId,
              chunkIndex: 0,
              content: `widget widget content ${i}`,
              tokenCount: 4,
              embedding: [1, 0, 0],
              metadata: {},
              createdAt: new Date("2026-01-01T00:00:00Z"),
            },
          };
        });
        return { candidates, sourceMetaByDocumentId };
      },
    };
  }

  it("settings 미주입 시 기본값(topK=10) 을 유지한다", async () => {
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: manyCandidates(15),
    });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: { query: "widget" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as { citations: unknown[] };
    expect(data.citations).toHaveLength(10);
  });

  it("org 의 ragTopK 설정을 invoke 시점 ctx.orgId 로 resolve 해 topK 로 사용한다(10 아님)", async () => {
    const settings: KnowledgeSearchSettingsPort = {
      async resolve(orgId) {
        expect(orgId).toBe("org-1");
        return { ...DEFAULT_ORG_SETTINGS, ragTopK: 12 };
      },
    };
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: manyCandidates(15),
      settings,
    });

    const result = await tool.invoke({
      toolCallId: "call-5",
      args: { query: "widget" },
      ctx: fakeToolContext({ orgId: "org-1" }),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as { citations: unknown[] };
    expect(data.citations).toHaveLength(12);
  });

  it("ragRelevanceThreshold 로 저점수 hit 을 필터한다", async () => {
    const retrieval: KnowledgeRetrievalPort = {
      async loadCandidates() {
        return {
          candidates: [
            {
              chunk: {
                id: "high-chunk",
                documentId: "doc-high",
                chunkIndex: 0,
                content: "widget 정확 일치",
                tokenCount: 3,
                embedding: [1, 0, 0],
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            },
            {
              chunk: {
                id: "low-chunk",
                documentId: "doc-low",
                chunkIndex: 0,
                content: "widget 거의 무관",
                tokenCount: 3,
                embedding: [0, 1, 0],
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            },
          ],
          sourceMetaByDocumentId: new Map([
            [
              "doc-high",
              {
                source: "project" as const,
                documentId: "doc-high",
                filename: "high.pdf",
              },
            ],
            [
              "doc-low",
              {
                source: "project" as const,
                documentId: "doc-low",
                filename: "low.pdf",
              },
            ],
          ]),
        };
      },
    };
    const settings: KnowledgeSearchSettingsPort = {
      async resolve() {
        return { ...DEFAULT_ORG_SETTINGS, ragRelevanceThreshold: 0.5 };
      },
    };
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval,
      settings,
    });

    const result = await tool.invoke({
      toolCallId: "call-6",
      args: { query: "widget" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      citations: Array<{ filename: string }>;
    };
    expect(data.citations).toHaveLength(1);
    expect(data.citations[0]?.filename).toBe("high.pdf");
  });

  it("reranker 가 주입되면 citations 를 RRF 순서가 아니라 reranker 점수 순서로 정렬한다", async () => {
    // 두 후보: doc-a(RRF 상 vector 완전일치=상위), doc-b(하위). reranker 는 역순 선호.
    const retrieval: KnowledgeRetrievalPort = {
      async loadCandidates() {
        return {
          candidates: [
            {
              chunk: {
                id: "a-chunk",
                documentId: "doc-a",
                chunkIndex: 0,
                content: "widget alpha",
                tokenCount: 2,
                embedding: [1, 0, 0],
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            },
            {
              chunk: {
                id: "b-chunk",
                documentId: "doc-b",
                chunkIndex: 0,
                content: "widget beta",
                tokenCount: 2,
                embedding: [1, 0, 0],
                metadata: {},
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            },
          ],
          sourceMetaByDocumentId: new Map([
            [
              "doc-a",
              {
                source: "project" as const,
                documentId: "doc-a",
                filename: "alpha.pdf",
              },
            ],
            [
              "doc-b",
              {
                source: "project" as const,
                documentId: "doc-b",
                filename: "beta.pdf",
              },
            ],
          ]),
        };
      },
    };
    const reranker = {
      name: "fake-rerank",
      async rerank(_q: string, docs: string[]) {
        // beta 를 더 relevant 로 (RRF 상위인 alpha 보다 앞서게)
        return docs.map((d, index) => ({
          index,
          score: d.includes("beta") ? 0.9 : 0.1,
        }));
      },
    };
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval,
      reranker,
    });

    const result = await tool.invoke({
      toolCallId: "call-rerank",
      args: { query: "widget" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      citations: Array<{ index: number; filename: string }>;
    };
    // reranker 가 beta 를 먼저 → citation[1] = beta.pdf
    expect(data.citations.map((c) => c.filename)).toEqual([
      "beta.pdf",
      "alpha.pdf",
    ]);
    // citation index 는 1..N 로 재부여(citation-helper 일관)
    expect(data.citations.map((c) => c.index)).toEqual([1, 2]);
  });

  it("reranker 미주입 시 기존 RRF 순서 동작이 그대로 유지된다(회귀 없음)", async () => {
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: manyCandidates(15),
    });

    const result = await tool.invoke({
      toolCallId: "call-no-rerank",
      args: { query: "widget" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as { citations: unknown[] };
    expect(data.citations).toHaveLength(10);
  });

  it("settings.resolve 가 실패해도 throw 하지 않고 DEFAULT_ORG_SETTINGS(topK=10) 로 폴백한다", async () => {
    const settings: KnowledgeSearchSettingsPort = {
      async resolve() {
        throw new Error("db down");
      },
    };
    const tool = createKnowledgeSearchTool({
      embeddingProvider: fakeEmbeddingProvider([1, 0, 0]),
      retrieval: manyCandidates(15),
      settings,
    });

    const result = await tool.invoke({
      toolCallId: "call-7",
      args: { query: "widget" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as { citations: unknown[] };
    expect(data.citations).toHaveLength(10);
  });
});

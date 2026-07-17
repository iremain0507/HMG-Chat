import { describe, it, expect } from "vitest";
import type { EmbeddingProvider, LLMProvider } from "@wchat/interfaces";
import { assembleBuiltinTools } from "../assemble-builtin-tools.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { ObjectStore } from "../../lib/object-store.js";
import type { KnowledgeRetrievalPort } from "../handlers/knowledge-search-handler.js";

function fakeProvider(): LLMProvider {
  return {
    // eslint-disable-next-line require-yield
    async *chat() {
      return;
    },
  } as unknown as LLMProvider;
}

function fakeArtifactDa(): ArtifactDataAccess {
  return {
    artifacts: {
      async insert() {
        throw new Error("not used at assembly time");
      },
    },
  } as unknown as ArtifactDataAccess;
}

function fakeObjectStore(): ObjectStore {
  return {
    async put() {},
    async get() {
      return Buffer.from("");
    },
    async exists() {
      return false;
    },
    async remove() {},
  } as unknown as ObjectStore;
}

function base() {
  return {
    provider: fakeProvider(),
    model: "claude-sonnet-5",
    maxTokens: 1024,
    artifactDa: fakeArtifactDa(),
    objectStore: fakeObjectStore(),
  };
}

function fakeEmbeddingProvider(): EmbeddingProvider {
  return {
    name: "fake-embed",
    dim: 3,
    async embed(input) {
      return input.map(() => [1, 0, 0]);
    },
  };
}

function fakeRetrieval(): KnowledgeRetrievalPort {
  return {
    async loadCandidates() {
      return { candidates: [], sourceMetaByDocumentId: new Map() };
    },
  };
}

describe("tools/assembleBuiltinTools", () => {
  it("내장 도구 4종을 조립한다(artifact_create/web_search/code_interpreter/deep_research)", () => {
    const names = assembleBuiltinTools(base())
      .map((t) => t.spec.name)
      .sort();
    expect(names).toEqual([
      "artifact_create",
      "code_interpreter",
      "deep_research",
      "web_search",
    ]);
  });

  it("TAVILY_API_KEY 유무와 무관하게 web_search 를 포함(키 있으면 실 Tavily, 없으면 dev-stub 폴백)", () => {
    const withKey = assembleBuiltinTools({ ...base(), tavilyApiKey: "tvly-x" });
    const noKey = assembleBuiltinTools(base());
    expect(withKey.some((t) => t.spec.name === "web_search")).toBe(true);
    expect(noKey.some((t) => t.spec.name === "web_search")).toBe(true);
  });

  it("E2B_API_KEY 없으면 dev-stub 샌드박스로 code_interpreter 를 조립(예외 없음)", () => {
    const tools = assembleBuiltinTools(base());
    expect(tools.some((t) => t.spec.name === "code_interpreter")).toBe(true);
  });

  it("retrieval+embeddingProvider 주입 시 knowledge_search 를 포함해 5종 도구를 조립한다(P20-T1-02)", () => {
    const names = assembleBuiltinTools({
      ...base(),
      embeddingProvider: fakeEmbeddingProvider(),
      retrieval: fakeRetrieval(),
    })
      .map((t) => t.spec.name)
      .sort();
    expect(names).toEqual([
      "artifact_create",
      "code_interpreter",
      "deep_research",
      "knowledge_search",
      "web_search",
    ]);
  });

  it("retrieval 미주입 시 knowledge_search 를 조립하지 않는다(L1 last-mile — 주입 유무로 목록이 갈림)", () => {
    const names = assembleBuiltinTools(base()).map((t) => t.spec.name);
    expect(names).not.toContain("knowledge_search");
  });
});

import { describe, it, expect } from "vitest";
import type { EmbeddingProvider, LLMProvider } from "@wchat/interfaces";
import { assembleBuiltinTools } from "../assemble-builtin-tools.js";
import { createDevStubImageGenProvider } from "../image-gen-provider-dev-stub.js";
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

function fakeSessions() {
  return {
    async search() {
      return [];
    },
    async byId() {
      return null;
    },
  };
}

function fakeSessionMessages() {
  return {
    async list() {
      return { items: [] };
    },
  };
}

function fakeMemories() {
  return {
    userMemories: {
      async insert(data: Record<string, unknown>) {
        return { id: "mem-1", ...data };
      },
      async list() {
        return { items: [] };
      },
    },
  };
}

function base() {
  return {
    provider: fakeProvider(),
    model: "claude-sonnet-5",
    maxTokens: 1024,
    artifactDa: fakeArtifactDa(),
    objectStore: fakeObjectStore(),
    sessions: fakeSessions(),
    sessionMessages: fakeSessionMessages(),
    memories: fakeMemories(),
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
  it("내장 도구 8종을 조립한다(artifact_create/web_search/code_interpreter/deep_research/search_chats/view_chat/add_memory/search_memories)", () => {
    const names = assembleBuiltinTools(base())
      .map((t) => t.spec.name)
      .sort();
    expect(names).toEqual([
      "add_memory",
      "artifact_create",
      "code_interpreter",
      "deep_research",
      "search_chats",
      "search_memories",
      "view_chat",
      "web_search",
    ]);
  });

  it("search_chats/view_chat 은 sessions/sessionMessages 없이도 생략되지 않고 항상 조립된다(P20-T2-01 L1 last-mile)", () => {
    const names = assembleBuiltinTools(base()).map((t) => t.spec.name);
    expect(names).toContain("search_chats");
    expect(names).toContain("view_chat");
  });

  it("add_memory/search_memories 는 memories 주입만으로 항상 조립된다(P20-T1-10 L1 last-mile)", () => {
    const names = assembleBuiltinTools(base()).map((t) => t.spec.name);
    expect(names).toContain("add_memory");
    expect(names).toContain("search_memories");
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

  it("retrieval+embeddingProvider 주입 시 knowledge_search 를 포함해 9종 도구를 조립한다(P20-T1-02)", () => {
    const names = assembleBuiltinTools({
      ...base(),
      embeddingProvider: fakeEmbeddingProvider(),
      retrieval: fakeRetrieval(),
    })
      .map((t) => t.spec.name)
      .sort();
    expect(names).toEqual([
      "add_memory",
      "artifact_create",
      "code_interpreter",
      "deep_research",
      "knowledge_search",
      "search_chats",
      "search_memories",
      "view_chat",
      "web_search",
    ]);
  });

  it("retrieval 미주입 시 knowledge_search 를 조립하지 않는다(L1 last-mile — 주입 유무로 목록이 갈림)", () => {
    const names = assembleBuiltinTools(base()).map((t) => t.spec.name);
    expect(names).not.toContain("knowledge_search");
  });

  it("imageGenPort 미주입(또는 imageGenEnabled=false) 시 image_generate 를 조립하지 않는다(P22-T1-08 assembly gate — knowledge_search optional gate 미러)", () => {
    const names = assembleBuiltinTools(base()).map((t) => t.spec.name);
    expect(names).not.toContain("image_generate");
  });

  it("imageGenPort 주입 + imageGenEnabled=true 시 image_generate 를 포함한다(P22-T1-08)", () => {
    const names = assembleBuiltinTools({
      ...base(),
      imageGenEnabled: true,
      imageGenPort: createDevStubImageGenProvider(),
    }).map((t) => t.spec.name);
    expect(names).toContain("image_generate");
  });

  it("imageGenPort 주입돼도 imageGenEnabled=false 면 image_generate 를 조립하지 않는다(P22-T1-08 flag gate)", () => {
    const names = assembleBuiltinTools({
      ...base(),
      imageGenEnabled: false,
      imageGenPort: createDevStubImageGenProvider(),
    }).map((t) => t.spec.name);
    expect(names).not.toContain("image_generate");
  });
});

import { describe, it, expect } from "vitest";
import type { LLMProvider } from "@wchat/interfaces";
import { assembleBuiltinTools } from "../assemble-builtin-tools.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { ObjectStore } from "../../lib/object-store.js";

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
});

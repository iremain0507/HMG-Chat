import { describe, it, expect } from "vitest";
import type { AgentTool, EmbeddingProvider } from "@wchat/interfaces";
import { createDevStubEmbeddingProvider } from "../../knowledge/embedding-provider-dev-stub.js";
import { selectRelevantTools } from "../tool-router.js";

function makeTool(name: string, description: string): AgentTool {
  return {
    spec: {
      name,
      description,
      inputSchema: { type: "object", properties: {} },
      permissionTier: "tool",
      defaultPolicy: "allow",
    },
    async invoke({ toolCallId }) {
      return { toolCallId, content: { kind: "text", text: "unused" } };
    },
  };
}

describe("tool-router.selectRelevantTools — 대규모 카탈로그 top-k 선택 (P12-T2-07)", () => {
  it("카탈로그가 topK 이하면 임베딩 호출 없이 전체를 그대로 반환한다", async () => {
    const tools = [makeTool("a", "desc a"), makeTool("b", "desc b")];
    const embeddingProvider: EmbeddingProvider = {
      name: "should-not-be-called",
      dim: 4,
      async embed() {
        throw new Error("embed 는 호출되면 안 된다");
      },
    };

    const result = await selectRelevantTools({
      tools,
      query: "무엇이든",
      topK: 5,
      embeddingProvider,
    });

    expect(result).toEqual(tools);
  });

  it("카탈로그가 topK 를 초과하면 query 와 관련도 높은 tool subset(top-k)만 반환한다", async () => {
    const matching = makeTool(
      "web_search",
      "search the web for real time information and breaking news articles",
    );
    const distractors = [
      makeTool("translate_text", "translate input text into another language"),
      makeTool(
        "unit_convert",
        "convert units between kilometers miles celsius fahrenheit",
      ),
      makeTool(
        "calendar_schedule",
        "schedule and manage calendar events and reminders",
      ),
      makeTool(
        "image_generate",
        "generate an image from a text prompt using diffusion",
      ),
    ];
    const tools = [...distractors, matching];
    const embeddingProvider = createDevStubEmbeddingProvider();

    const result = await selectRelevantTools({
      tools,
      query: "search the web for the latest breaking news",
      topK: 1,
      embeddingProvider,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.spec.name).toBe("web_search");
  });

  it("topK<=0 이면 빈 배열을 반환한다", async () => {
    const tools = [makeTool("a", "desc a")];

    const result = await selectRelevantTools({
      tools,
      query: "q",
      topK: 0,
      embeddingProvider: createDevStubEmbeddingProvider(),
    });

    expect(result).toEqual([]);
  });
});

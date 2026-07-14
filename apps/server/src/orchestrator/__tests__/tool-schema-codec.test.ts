import { describe, expect, it } from "vitest";
import type { AgentToolSpec, ChatInput, JsonSchema } from "@wchat/interfaces";
import {
  toAnthropicToolFormat,
  toAnthropicToolChoiceFormat,
  toOpenAIToolFormat,
  toOpenAIToolChoiceFormat,
  toGeminiToolFormat,
  toGeminiToolChoiceFormat,
} from "../tool-schema-codec.js";

const inputSchema: JsonSchema = {
  type: "object",
  properties: { query: { type: "string" } },
  required: ["query"],
};

const spec: AgentToolSpec = {
  name: "web_search",
  description: "웹 검색",
  inputSchema,
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent", "web"],
};

describe("tool-schema-codec.toAnthropicToolFormat", () => {
  it("AgentToolSpec[] 을 anthropic input_schema 골든포맷으로 변환한다", () => {
    expect(toAnthropicToolFormat([spec])).toEqual([
      {
        name: "web_search",
        description: "웹 검색",
        input_schema: inputSchema,
      },
    ]);
  });
});

describe("tool-schema-codec.toOpenAIToolFormat", () => {
  it("AgentToolSpec[] 을 openai function.parameters 골든포맷으로 변환한다", () => {
    expect(toOpenAIToolFormat([spec])).toEqual([
      {
        type: "function",
        function: {
          name: "web_search",
          description: "웹 검색",
          parameters: inputSchema,
        },
      },
    ]);
  });
});

describe("tool-schema-codec.toGeminiToolFormat", () => {
  it("AgentToolSpec[] 을 gemini functionDeclarations 골든포맷으로 변환한다", () => {
    expect(toGeminiToolFormat([spec])).toEqual([
      {
        functionDeclarations: [
          {
            name: "web_search",
            description: "웹 검색",
            parameters: inputSchema,
          },
        ],
      },
    ]);
  });
});

describe("tool-schema-codec toolChoice 매핑", () => {
  const cases: Array<{
    label: string;
    toolChoice: ChatInput["toolChoice"];
  }> = [
    { label: "auto", toolChoice: "auto" },
    { label: "any", toolChoice: "any" },
    { label: "named tool", toolChoice: { type: "tool", name: "web_search" } },
  ];

  it("anthropic: auto/any/named 매핑", () => {
    expect(toAnthropicToolChoiceFormat("auto")).toEqual({ type: "auto" });
    expect(toAnthropicToolChoiceFormat("any")).toEqual({ type: "any" });
    expect(
      toAnthropicToolChoiceFormat({ type: "tool", name: "web_search" }),
    ).toEqual({ type: "tool", name: "web_search" });
    expect(toAnthropicToolChoiceFormat(undefined)).toBeUndefined();
  });

  it("openai: auto/any(required)/named 매핑", () => {
    expect(toOpenAIToolChoiceFormat("auto")).toEqual("auto");
    expect(toOpenAIToolChoiceFormat("any")).toEqual("required");
    expect(
      toOpenAIToolChoiceFormat({ type: "tool", name: "web_search" }),
    ).toEqual({ type: "function", function: { name: "web_search" } });
    expect(toOpenAIToolChoiceFormat(undefined)).toBeUndefined();
  });

  it("gemini: auto/any(ANY)/named 매핑 (allowedFunctionNames)", () => {
    expect(toGeminiToolChoiceFormat("auto")).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
    expect(toGeminiToolChoiceFormat("any")).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
    expect(
      toGeminiToolChoiceFormat({ type: "tool", name: "web_search" }),
    ).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["web_search"],
      },
    });
    expect(toGeminiToolChoiceFormat(undefined)).toBeUndefined();
  });

  // cases 배열은 3-provider 매핑이 동일 toolChoice 입력에 대해 모두 정의되는지 회귀 방지용.
  it.each(cases)(
    "$label 은 3개 provider 모두에서 정의된 값을 반환한다",
    ({ toolChoice }) => {
      expect(toAnthropicToolChoiceFormat(toolChoice)).toBeDefined();
      expect(toOpenAIToolChoiceFormat(toolChoice)).toBeDefined();
      expect(toGeminiToolChoiceFormat(toolChoice)).toBeDefined();
    },
  );
});

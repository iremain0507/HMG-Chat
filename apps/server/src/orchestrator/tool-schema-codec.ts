import type { AgentToolSpec, ChatInput, JsonSchema } from "@wchat/interfaces";

// provider 중립 AgentToolSpec[] → 각 provider 네이티브 tool 포맷 순수변환.
// packages/interfaces 는 무변경 — 이 파일이 유일한 provider-schema 변환 지점(P11-T2-05/06 어댑터가 재사용).

export interface AnthropicToolFormat {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface OpenAIToolFormat {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface GeminiToolFormat {
  functionDeclarations: GeminiFunctionDeclaration[];
}

export function toAnthropicToolFormat(
  tools: AgentToolSpec[],
): AnthropicToolFormat[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export function toOpenAIToolFormat(tools: AgentToolSpec[]): OpenAIToolFormat[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
}

export function toGeminiToolFormat(tools: AgentToolSpec[]): GeminiToolFormat[] {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      })),
    },
  ];
}

// ─── toolChoice 매핑: ChatInput["toolChoice"] = "auto" | "any" | {type:"tool", name} ───

export interface AnthropicToolChoiceFormat {
  type: "auto" | "any" | "tool";
  name?: string;
}

export function toAnthropicToolChoiceFormat(
  toolChoice: ChatInput["toolChoice"],
): AnthropicToolChoiceFormat | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto") return { type: "auto" };
  if (toolChoice === "any") return { type: "any" };
  return { type: "tool", name: toolChoice.name };
}

export type OpenAIToolChoiceFormat =
  "auto" | "required" | { type: "function"; function: { name: string } };

export function toOpenAIToolChoiceFormat(
  toolChoice: ChatInput["toolChoice"],
): OpenAIToolChoiceFormat | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto") return "auto";
  if (toolChoice === "any") return "required";
  return { type: "function", function: { name: toolChoice.name } };
}

export interface GeminiToolChoiceFormat {
  functionCallingConfig: {
    mode: "AUTO" | "ANY";
    allowedFunctionNames?: string[];
  };
}

export function toGeminiToolChoiceFormat(
  toolChoice: ChatInput["toolChoice"],
): GeminiToolChoiceFormat | undefined {
  if (!toolChoice) return undefined;
  if (toolChoice === "auto") {
    return { functionCallingConfig: { mode: "AUTO" } };
  }
  if (toolChoice === "any") {
    return { functionCallingConfig: { mode: "ANY" } };
  }
  return {
    functionCallingConfig: {
      mode: "ANY",
      allowedFunctionNames: [toolChoice.name],
    },
  };
}

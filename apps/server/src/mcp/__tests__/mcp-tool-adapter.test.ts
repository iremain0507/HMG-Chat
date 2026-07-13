// mcp-tool-adapter.test.ts — P8-T1-02 RED: mcp/mcp-tool-adapter.ts 모듈이 없어 실패한다.
// MCP 원시 tools/list · tools/call 응답을 14-INTERFACES.md § 1,7 AgentToolSpec/AgentToolResult
// 로 변환하는 순수 어댑터. namespaced tool name(mcp:{serverId}:{toolName}) 으로 충돌 방지.
import { describe, expect, it } from "vitest";
import { WChatError } from "@wchat/interfaces";
import {
  mcpResultToAgentToolResult,
  mcpToolName,
  mcpToolToAgentToolSpec,
} from "../mcp-tool-adapter.js";

describe("mcpToolName", () => {
  it("serverId:toolName 을 mcp: 네임스페이스로 합친다", () => {
    expect(mcpToolName("srv-1", "search")).toBe("mcp:srv-1:search");
  });
});

describe("mcpToolToAgentToolSpec", () => {
  it("MCP 원시 tool 을 AgentToolSpec 으로 변환한다", () => {
    const spec = mcpToolToAgentToolSpec("srv-1", {
      name: "search",
      description: "사내 검색",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
    });
    expect(spec).toMatchObject({
      name: "mcp:srv-1:search",
      description: "사내 검색",
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      permissionTier: "tool",
      defaultPolicy: "hitl",
    });
  });

  it("description 이 없으면 tool name 으로 대체한다", () => {
    const spec = mcpToolToAgentToolSpec("srv-1", { name: "ping" });
    expect(spec.description).toBe("ping");
    expect(spec.inputSchema).toEqual({ type: "object" });
  });
});

describe("mcpResultToAgentToolResult", () => {
  it("text content 를 kind:text 로 변환한다", () => {
    const result = mcpResultToAgentToolResult("call-1", {
      content: [{ type: "text", text: "결과입니다" }],
    });
    expect(result).toEqual({
      toolCallId: "call-1",
      content: { kind: "text", text: "결과입니다" },
    });
  });

  it("content 가 여러 개면 text 를 합친다", () => {
    const result = mcpResultToAgentToolResult("call-1", {
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
    expect(result.content).toEqual({ kind: "text", text: "a\nb" });
  });

  it("isError:true 면 kind:error(WChatError) 로 변환한다", () => {
    const result = mcpResultToAgentToolResult("call-1", {
      isError: true,
      content: [{ type: "text", text: "실패 사유" }],
    });
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error).toBeInstanceOf(WChatError);
      expect(result.content.error.category).toBe("mcp");
      expect(result.content.error.message).toBe("실패 사유");
    }
  });

  it("content 가 비어있으면 빈 text 로 변환한다", () => {
    const result = mcpResultToAgentToolResult("call-1", {});
    expect(result.content).toEqual({ kind: "text", text: "" });
  });
});

import { describe, it, expect } from "vitest";
import type { ToolContext } from "@wchat/interfaces";
import {
  createSearchChatsTool,
  createViewChatTool,
  type SearchChatsSessionsPort,
  type ViewChatMessagesPort,
  type ViewChatSessionsPort,
} from "../search-chats-handler.js";

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

describe("createSearchChatsTool", () => {
  it("spec 은 search_chats 계약(allow policy + read-only/idempotent tags)을 만족한다", () => {
    const tool = createSearchChatsTool({
      sessions: {
        async search() {
          return [];
        },
      },
    });
    expect(tool.spec.name).toBe("search_chats");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(
      expect.arrayContaining(["read-only", "idempotent"]),
    );
  });

  it("ctx.userId 로만 검색하고(다른 유저 파라미터 무시) 결과를 tool_result json 으로 반환한다", async () => {
    let seenUserId = "";
    const sessions: SearchChatsSessionsPort = {
      async search(userId, query) {
        seenUserId = userId;
        return [
          {
            id: "s1",
            title: `hit for ${query}`,
            lastMessageAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ];
      },
    };
    const tool = createSearchChatsTool({ sessions });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { query: "widget" },
      ctx: fakeToolContext({ userId: "user-42" }),
    });

    expect(seenUserId).toBe("user-42");
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toEqual({
        query: "widget",
        results: [
          {
            sessionId: "s1",
            title: "hit for widget",
            lastMessageAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
  });

  it("query 가 비어있으면 INVALID_INPUT 에러를 반환하고 sessions.search 를 호출하지 않는다", async () => {
    let called = false;
    const tool = createSearchChatsTool({
      sessions: {
        async search() {
          called = true;
          return [];
        },
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { query: "   " },
      ctx: fakeToolContext(),
    });

    expect(called).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });
});

describe("createViewChatTool", () => {
  it("spec 은 view_chat 계약(allow policy + read-only/idempotent tags)을 만족한다", () => {
    const tool = createViewChatTool({
      sessions: {
        async byId() {
          return null;
        },
      },
      messages: {
        async list() {
          return { items: [] };
        },
      },
    });
    expect(tool.spec.name).toBe("view_chat");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(
      expect.arrayContaining(["read-only", "idempotent"]),
    );
  });

  it("본인 소유 세션이면 메시지 히스토리를 tool_result json 으로 반환한다", async () => {
    const sessions: ViewChatSessionsPort = {
      async byId(id) {
        return { id, userId: "user-1", title: "my session" };
      },
    };
    const messages: ViewChatMessagesPort = {
      async list({ sessionId }) {
        return {
          items: [
            {
              role: "user",
              content: `hi in ${sessionId}`,
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
            },
          ],
        };
      },
    };
    const tool = createViewChatTool({ sessions, messages });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { sessionId: "sess-1" },
      ctx: fakeToolContext({ userId: "user-1" }),
    });

    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toEqual({
        sessionId: "sess-1",
        title: "my session",
        messages: [
          {
            role: "user",
            content: "hi in sess-1",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
    }
  });

  it("타 유저 소유 세션이면 NOT_FOUND 에러를 반환한다(existence-leak 방지, messages.list 미호출)", async () => {
    let listCalled = false;
    const sessions: ViewChatSessionsPort = {
      async byId(id) {
        return { id, userId: "other-user", title: "not mine" };
      },
    };
    const messages: ViewChatMessagesPort = {
      async list() {
        listCalled = true;
        return { items: [] };
      },
    };
    const tool = createViewChatTool({ sessions, messages });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: { sessionId: "sess-2" },
      ctx: fakeToolContext({ userId: "user-1" }),
    });

    expect(listCalled).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("NOT_FOUND");
    }
  });

  it("존재하지 않는 세션이면 NOT_FOUND 에러를 반환한다", async () => {
    const tool = createViewChatTool({
      sessions: {
        async byId() {
          return null;
        },
      },
      messages: {
        async list() {
          return { items: [] };
        },
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-5",
      args: { sessionId: "missing" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("NOT_FOUND");
    }
  });

  it("sessionId 가 비어있으면 INVALID_INPUT 에러를 반환한다", async () => {
    const tool = createViewChatTool({
      sessions: {
        async byId() {
          return null;
        },
      },
      messages: {
        async list() {
          return { items: [] };
        },
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-6",
      args: { sessionId: "" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });
});

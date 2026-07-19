import { describe, it, expect } from "vitest";
import type { ToolContext, UserMemory } from "@wchat/interfaces";
import {
  createAddMemoryTool,
  createSearchMemoriesTool,
  type MemoryToolsPort,
} from "../memory-tool-handler.js";

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

function fakeMemory(overrides?: Partial<UserMemory>): UserMemory {
  return {
    id: "mem-1",
    userId: "user-1",
    category: "user",
    content: "좋아하는 색은 파란색",
    source: "auto-extract",
    sessionId: null,
    pinned: false,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createAddMemoryTool", () => {
  it("spec 은 add_memory 계약(allow policy)을 만족한다", () => {
    const tool = createAddMemoryTool({
      memories: {
        userMemories: {
          async insert(d) {
            return fakeMemory(d);
          },
        },
      },
    } as unknown as { memories: MemoryToolsPort });
    expect(tool.spec.name).toBe("add_memory");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
  });

  it("ctx.userId 소유로 INSERT 하고(args.userId 무시) tool_result json 을 반환한다", async () => {
    let seenInsert: Record<string, unknown> | null = null;
    const memories: MemoryToolsPort = {
      userMemories: {
        async insert(data) {
          seenInsert = data as Record<string, unknown>;
          return fakeMemory({ id: "mem-42", ...(data as Partial<UserMemory>) });
        },
      } as unknown as MemoryToolsPort["userMemories"],
    };
    const tool = createAddMemoryTool({ memories });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: {
        category: "user",
        content: "사용자는 파란색을 좋아한다",
        userId: "attacker-controlled",
      },
      ctx: fakeToolContext({ userId: "user-42" }),
    });

    expect(seenInsert).toMatchObject({
      userId: "user-42",
      category: "user",
      content: "사용자는 파란색을 좋아한다",
    });
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toMatchObject({
        memoryId: "mem-42",
        category: "user",
      });
    }
  });

  it("content 가 비어있으면 INVALID_INPUT 에러를 반환하고 insert 를 호출하지 않는다", async () => {
    let called = false;
    const memories: MemoryToolsPort = {
      userMemories: {
        async insert() {
          called = true;
          return fakeMemory();
        },
      } as unknown as MemoryToolsPort["userMemories"],
    };
    const tool = createAddMemoryTool({ memories });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { category: "user", content: "   " },
      ctx: fakeToolContext(),
    });

    expect(called).toBe(false);
    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("category 가 올바르지 않으면 INVALID_INPUT 에러를 반환한다", async () => {
    const memories: MemoryToolsPort = {
      userMemories: {
        async insert() {
          return fakeMemory();
        },
      } as unknown as MemoryToolsPort["userMemories"],
    };
    const tool = createAddMemoryTool({ memories });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { category: "not-a-category", content: "hi" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });
});

describe("createSearchMemoriesTool", () => {
  it("spec 은 search_memories 계약(allow policy + read-only/idempotent tags)을 만족한다", () => {
    const tool = createSearchMemoriesTool({
      memories: {
        userMemories: {
          async list() {
            return { items: [] };
          },
        } as unknown as MemoryToolsPort["userMemories"],
      },
    });
    expect(tool.spec.name).toBe("search_memories");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(
      expect.arrayContaining(["read-only", "idempotent"]),
    );
  });

  it("ctx.userId 로만 조회하고(다른 유저 파라미터 무시) 핀/최근 순 결과를 반환한다", async () => {
    let seenFilter: Record<string, unknown> | null = null;
    const memories: MemoryToolsPort = {
      userMemories: {
        async list(filter) {
          seenFilter = filter as Record<string, unknown>;
          return {
            items: [
              fakeMemory({ id: "mem-a", pinned: true, content: "핀 고정" }),
              fakeMemory({ id: "mem-b", content: "최근" }),
            ],
          };
        },
      } as unknown as MemoryToolsPort["userMemories"],
    };
    const tool = createSearchMemoriesTool({ memories });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: { userId: "attacker-controlled" },
      ctx: fakeToolContext({ userId: "user-77" }),
    });

    expect(seenFilter).toMatchObject({ userId: "user-77" });
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      expect(result.content.data).toMatchObject({
        results: [
          { memoryId: "mem-a", pinned: true, content: "핀 고정" },
          { memoryId: "mem-b", pinned: false, content: "최근" },
        ],
      });
    }
  });

  it("category 필터를 지정하면 list 필터에 반영된다", async () => {
    let seenFilter: Record<string, unknown> | null = null;
    const memories: MemoryToolsPort = {
      userMemories: {
        async list(filter) {
          seenFilter = filter as Record<string, unknown>;
          return { items: [] };
        },
      } as unknown as MemoryToolsPort["userMemories"],
    };
    const tool = createSearchMemoriesTool({ memories });

    await tool.invoke({
      toolCallId: "call-5",
      args: { category: "project" },
      ctx: fakeToolContext(),
    });

    expect(seenFilter).toMatchObject({ category: "project" });
  });

  it("category 가 올바르지 않으면 INVALID_INPUT 에러를 반환한다", async () => {
    const tool = createSearchMemoriesTool({
      memories: {
        userMemories: {
          async list() {
            return { items: [] };
          },
        } as unknown as MemoryToolsPort["userMemories"],
      },
    });

    const result = await tool.invoke({
      toolCallId: "call-6",
      args: { category: "nope" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });
});

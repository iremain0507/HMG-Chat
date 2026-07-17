// memory-tool-handler.ts — add_memory/search_memories AgentTool 2종: 모델이 대화 중 사용자
//   사실/선호를 스스로 저장·조회한다(Open WebUI persistent memory 자율 도구 참고). 기존
//   user_memories 저장은 UI/REST(routes/memories.ts) 전용이었고 모델 접근 경로가 0 이었다 —
//   assemble-builtin-tools.ts 조립 전까지는 모델이 이 능력 자체를 못 본다(L1 last-mile).
//   ownership 은 핸들러 내부에서 강제: args 에 실린 userId 는 항상 무시하고 ctx.userId 로만
//   INSERT/조회한다(routes/memories.ts 의 application-level 격리와 동일 원칙, cross-actor 오염 방지).
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  DataAccess,
  UserMemory,
} from "@wchat/interfaces";

const CATEGORIES = ["user", "feedback", "project", "reference"] as const;

function isCategory(v: unknown): v is UserMemory["category"] {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

// app.ts 의 createPgUserMemoryDataAccess() 반환 타입(UserMemoryDataAccess)과 구조적으로 동일 —
// db/user-memory-data-access.ts 를 직접 import 하지 않고 인터페이스만 재정의(search-chats-handler
// 패턴과 동일, handlers 는 db 모듈에 직접 의존하지 않는다).
export type MemoryToolsPort = Pick<DataAccess, "userMemories">;

export const addMemoryToolSpec: AgentToolSpec = {
  name: "add_memory",
  description:
    "대화 중 파악한 사용자 사실/선호/프로젝트 맥락을 category(user/feedback/project/reference)와 content 로 저장한다.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      content: { type: "string" },
    },
    required: ["category", "content"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
};

export const searchMemoriesToolSpec: AgentToolSpec = {
  name: "search_memories",
  description:
    "호출자 본인의 저장된 메모리를 category 필터(선택)로 조회한다. 핀 고정 항목 우선, 이후 최근 순으로 반환한다.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string" },
      limit: { type: "integer" },
    },
    required: [],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent"],
};

export function createAddMemoryTool(deps: {
  memories: MemoryToolsPort;
}): AgentTool {
  return {
    spec: addMemoryToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const content =
        typeof args.content === "string" ? args.content.trim() : "";
      if (!content) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "content 가 필요합니다.",
            ),
          },
        };
      }
      if (!isCategory(args.category)) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "category 가 올바르지 않습니다.",
            ),
          },
        };
      }
      const memory = await deps.memories.userMemories.insert({
        userId: ctx.userId,
        category: args.category,
        content,
        source: "auto-extract",
        sessionId: ctx.sessionId,
        pinned: false,
        metadata: null,
      });
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            memoryId: memory.id,
            category: memory.category,
            content: memory.content,
          },
        },
      };
    },
  };
}

export function createSearchMemoriesTool(deps: {
  memories: MemoryToolsPort;
}): AgentTool {
  return {
    spec: searchMemoriesToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      if (args.category !== undefined && !isCategory(args.category)) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "category 가 올바르지 않습니다.",
            ),
          },
        };
      }
      const limit = typeof args.limit === "number" ? args.limit : 20;
      const { items } = await deps.memories.userMemories.list(
        {
          userId: ctx.userId,
          ...(isCategory(args.category) ? { category: args.category } : {}),
        },
        { limit },
      );
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            results: items.map((m) => ({
              memoryId: m.id,
              category: m.category,
              content: m.content,
              pinned: m.pinned,
            })),
          },
        },
      };
    },
  };
}

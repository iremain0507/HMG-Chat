// search-chats-handler.ts — search_chats/view_chat AgentTool 2종: 모델이 호출자 본인의
//   과거 대화를 네이티브 도구로 자율 검색/열람한다(Open WebUI search_chats/view_chat 참고).
//   knowledge_search 와 마찬가지로 app.ts 미조립이면 모델이 이 능력 자체를 못 본다(L1
//   last-mile) — assemble-builtin-tools.ts 가 조립 지점.
//   ownership 은 핸들러 내부에서 강제(routes/sessions.ts verifyOwnedMessage 와 동일 패턴):
//   search_chats 는 기존 SessionsDataAccess.search(userId, ...) 쿼리 자체가 user_id 로
//   스코프하고, view_chat 은 session.userId !== ctx.userId 면 존재 자체를 숨긴다(404 상당
//   NOT_FOUND, existence-leak 방지).
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, AgentToolSpec } from "@wchat/interfaces";

export const searchChatsToolSpec: AgentToolSpec = {
  name: "search_chats",
  description:
    "호출자 본인의 과거 대화 세션을 제목/메시지 내용/태그로 검색해 세션 목록(id/title/lastMessageAt)을 반환한다.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      limit: { type: "integer" },
    },
    required: ["query"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent"],
};

export const viewChatToolSpec: AgentToolSpec = {
  name: "view_chat",
  description:
    "sessionId 로 지정한 과거 대화(호출자 본인 소유)의 메시지 히스토리 전체를 조회한다.",
  inputSchema: {
    type: "object",
    properties: { sessionId: { type: "string" } },
    required: ["sessionId"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "idempotent"],
};

export interface SearchChatsSessionsPort {
  search(
    userId: string,
    query: string,
    limit?: number,
  ): Promise<
    Array<{ id: string; title: string | null; lastMessageAt: Date | null }>
  >;
}

export interface ViewChatSessionsPort {
  byId(
    id: string,
  ): Promise<{ id: string; userId: string; title: string | null } | null>;
}

// search_chats+view_chat 둘 다 세션 소유 검증/검색에 쓰는 결합 포트 — app.ts 는 기존
// SessionsDataAccess(session-data-access.ts) 인스턴스 하나를 구조적 타이핑으로 그대로 만족.
export type SessionsSearchPort = SearchChatsSessionsPort & ViewChatSessionsPort;

export interface ViewChatMessagesPort {
  list(filter: { sessionId: string }): Promise<{
    items: Array<{ role: string; content: unknown; createdAt: Date }>;
  }>;
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function createSearchChatsTool(deps: {
  sessions: SearchChatsSessionsPort;
}): AgentTool {
  return {
    spec: searchChatsToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "query 가 필요합니다.",
            ),
          },
        };
      }
      const limit = typeof args.limit === "number" ? args.limit : undefined;
      const results = await deps.sessions.search(ctx.userId, query, limit);
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            query,
            results: results.map((s) => ({
              sessionId: s.id,
              title: s.title,
              lastMessageAt: s.lastMessageAt ? isoOf(s.lastMessageAt) : null,
            })),
          },
        },
      };
    },
  };
}

export function createViewChatTool(deps: {
  sessions: ViewChatSessionsPort;
  messages: ViewChatMessagesPort;
}): AgentTool {
  return {
    spec: viewChatToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const sessionId =
        typeof args.sessionId === "string" ? args.sessionId.trim() : "";
      if (!sessionId) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "sessionId 가 필요합니다.",
            ),
          },
        };
      }
      const session = await deps.sessions.byId(sessionId);
      if (!session || session.userId !== ctx.userId) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "NOT_FOUND",
              "tool",
              false,
              "세션을 찾을 수 없습니다.",
            ),
          },
        };
      }
      const page = await deps.messages.list({ sessionId });
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            sessionId,
            title: session.title,
            messages: page.items.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: isoOf(m.createdAt),
            })),
          },
        },
      };
    },
  };
}

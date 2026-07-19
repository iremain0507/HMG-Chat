// import-conversations.ts — P22-T6-13(계약배치 C9) 대화 가져오기 파서 단일 출처.
//   Open WebUI 의 chat import 대응: 우리 내보내기 포맷(native, apps/web/src/lib/export-conversation.ts
//   conversationToJson 출력)과 ChatGPT conversations.json(mapping 그래프)을 공통
//   ParsedConversation[] 로 정규화한다.
//   packages/interfaces·shared 미사용(FROZEN 회피) — org-settings-schema.ts 와 동일한 LOCAL Zod
//   (승인서 CONTRACT_APPROVED "SCHEMAS: local", RFC C9).
//
//   순수 함수라 DB/HTTP 의존이 없다 — 라우트(routes/sessions.ts POST /import)는 이 결과를
//   auth 로 파생한 userId 로만 세션/메시지에 기록한다(payload 안의 userId/orgId 는 신뢰하지 않음).
import { z } from "zod";

export const IMPORT_FORMATS = ["native", "chatgpt"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const ImportConversationsRequestSchema = z.object({
  format: z.enum(IMPORT_FORMATS),
  payload: z.unknown(),
});

export type ImportConversationsRequest = z.infer<
  typeof ImportConversationsRequestSchema
>;

/** 두 포맷이 공통으로 정규화되는 형태. 라우트는 이것만 보고 세션/메시지를 만든다. */
export interface ParsedConversation {
  title: string | null;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/** 가져오기 대상 role — system/tool 등 나머지는 버린다(대화 재현에 불필요). */
function isChatRole(role: unknown): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

// ---------------------------------------------------------------- native

const NativeConversationSchema = z.object({
  title: z.string().nullish(),
  messages: z.array(
    z.object({ role: z.string(), content: z.string() }).passthrough(),
  ),
});

const NativePayloadSchema = z.union([
  NativeConversationSchema,
  z.array(NativeConversationSchema),
]);

function parseNative(payload: unknown): ParsedConversation[] {
  const parsed = NativePayloadSchema.parse(payload);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map((c) => ({
    title: c.title ?? null,
    messages: c.messages
      .filter((m) => isChatRole(m.role) && m.content !== "")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
  }));
}

// --------------------------------------------------------------- chatgpt

const ChatGptNodeSchema = z
  .object({
    id: z.string().optional(),
    parent: z.string().nullish(),
    message: z
      .object({
        author: z.object({ role: z.string() }).passthrough().nullish(),
        content: z
          .object({ parts: z.array(z.unknown()).nullish() })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

const ChatGptConversationSchema = z
  .object({
    title: z.string().nullish(),
    mapping: z.record(ChatGptNodeSchema),
  })
  .passthrough();

const ChatGptPayloadSchema = z.union([
  ChatGptConversationSchema,
  z.array(ChatGptConversationSchema),
]);

type ChatGptConversation = z.infer<typeof ChatGptConversationSchema>;

/** parts 는 문자열/객체 혼재(멀티모달) — 문자열만 이어붙인다. */
function partsToContent(parts: unknown[] | null | undefined): string {
  if (!parts) return "";
  return parts
    .filter((p): p is string => typeof p === "string")
    .join("\n")
    .trim();
}

/**
 * mapping 그래프를 **parent 포인터**로 평탄화한다.
 *   - parent 가 null 이거나 mapping 밖을 가리키면 루트.
 *   - 형제 순서는 mapping 키 순서(= 내보내기 순서)로 안정 정렬 — children 배열 유무에 의존하지 않는다.
 *   - user/assistant 이외 role, 본문이 빈 노드는 건너뛴다(구조는 유지한 채 메시지만 제외).
 */
function flattenMapping(conv: ChatGptConversation): ParsedConversation {
  const keys = Object.keys(conv.mapping);
  const childrenByParent = new Map<string | null, string[]>();
  for (const key of keys) {
    const node = conv.mapping[key];
    const parent =
      node?.parent != null && keys.includes(node.parent) ? node.parent : null;
    const bucket = childrenByParent.get(parent);
    if (bucket) bucket.push(key);
    else childrenByParent.set(parent, [key]);
  }

  const messages: ParsedConversation["messages"] = [];
  const visited = new Set<string>();
  const stack = [...(childrenByParent.get(null) ?? [])].reverse();
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (visited.has(key)) continue;
    visited.add(key);
    const node = conv.mapping[key];
    const role = node?.message?.author?.role;
    const content = partsToContent(node?.message?.content?.parts);
    if (isChatRole(role) && content !== "") {
      messages.push({ role, content });
    }
    const children = childrenByParent.get(key) ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push(children[i] as string);
    }
  }
  return { title: conv.title ?? null, messages };
}

function parseChatGpt(payload: unknown): ParsedConversation[] {
  const parsed = ChatGptPayloadSchema.parse(payload);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  return list.map(flattenMapping);
}

// ------------------------------------------------------------------ api

/**
 * 포맷별 payload → ParsedConversation[]. 유효한 메시지가 하나도 없는 대화는 버리고,
 * 남는 대화가 0개면 throw(라우트는 이를 400 INVALID_INPUT 으로 옮긴다 — 빈 가져오기로
 * 빈 세션이 양산되는 것을 막는다).
 */
export function parseImportPayload(
  format: ImportFormat,
  payload: unknown,
): ParsedConversation[] {
  const parsed =
    format === "native" ? parseNative(payload) : parseChatGpt(payload);
  const usable = parsed.filter((c) => c.messages.length > 0);
  if (usable.length === 0) {
    throw new Error("가져올 수 있는 대화가 없습니다.");
  }
  return usable;
}

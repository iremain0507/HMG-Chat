// routes/channels.ts — 실시간 다중사용자 채널 REST + SSE (P22-T6-12, 계약 승인 C8).
// Open WebUI 의 Channels(Discord 스타일 방 + 스레드 + 이모지 반응 + @model 협업) 파리티.
//
// 설계:
//   - db/channel-data-access.ts 는 RLS 를 superuser role 로 우회하므로, org 경계는 이 라우트가
//     application 레벨에서 강제한다. 다른 org 의 채널은 403 이 아니라 404 —
//     routes/notes.ts·agents.ts 와 동일한 existence-leak 방지 패턴.
//   - 방은 org 전체에 **보이고**(디렉터리), **쓰기만** 멤버 전용이다. 그래서
//     GET /:id/messages 는 비멤버도 200, POST 계열은 비멤버면 403 NOT_A_MEMBER.
//     (403 을 쓰는 이유: 같은 org 안에서는 방의 존재가 이미 공개라 숨길 것이 없다.)
//   - 방 설정 변경/삭제는 owner 멤버만. owner 가 나가도 방은 남는다(대화 기록 보존).
//   - @model 멘션은 routes/notes.ts enhance 와 달리 **fail-soft** 다 — 사람의 글은 이미 저장됐고,
//     모델이 답을 못 했다고 사람 글까지 실패시키면 데이터를 잃는다(21-LOOP-LESSONS L2).
//     다만 fire-and-forget 은 아니다: await 로 인라인 처리해 테스트에서 결정적으로 관측된다.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  LLMMessage,
  LLMProvider,
} from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { ChannelDataAccess } from "../db/channel-data-access.js";
import {
  publishChannelEvent,
  subscribeChannel,
  type ChannelEvent,
  type ChannelMessageDto,
} from "../orchestrator/channel-registry.js";

const MAX_NAME_CHARS = 100;
const MAX_DESCRIPTION_CHARS = 500;
const MAX_CONTENT_CHARS = 10_000;
const MAX_EMOJI_CHARS = 16;
const DEFAULT_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LIMIT = 500;
/** 멤버·반응 조회용 상한 — pg 구현체의 기본 limit(100)에 잘리지 않게 명시한다. */
const BULK_LIMIT = 1000;
/** @model 응답 생성 시 프롬프트에 싣는 최근 대화 수. */
const MODEL_CONTEXT_MESSAGES = 20;
const MODEL_MAX_TOKENS = 4096;

// "@model" 이 단어로 등장할 때만. a@modelrunner.com 같은 이메일은 걸리지 않는다.
const MODEL_MENTION_RE = /(^|\s)@model(\b|\s|$)/;

const CHANNEL_SYSTEM_PROMPT = `너는 팀 채널에 참여한 어시스턴트다. 규칙:
- 여러 사람이 함께 보는 공간이니 간결하고 정중하게 답한다.
- 대화 맥락을 참고해 마지막 요청에 답한다. 모르면 모른다고 말한다.
- 답변 본문만 출력한다. 인사말·메타 설명으로 늘리지 않는다.`;

const HEARTBEAT_MS = 30_000;

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

function meta() {
  return { requestId: randomUUID() };
}

function toChannelDto(channel: Channel) {
  return {
    id: channel.id,
    orgId: channel.orgId,
    name: channel.name,
    description: channel.description,
    createdBy: channel.createdBy,
    createdAt: channel.createdAt.toISOString(),
    updatedAt: channel.updatedAt.toISOString(),
  };
}

function toMemberDto(member: ChannelMember) {
  return {
    id: member.id,
    orgId: member.orgId,
    channelId: member.channelId,
    userId: member.userId,
    role: member.role,
    createdAt: member.createdAt.toISOString(),
  };
}

function toMessageDto(message: ChannelMessage): ChannelMessageDto {
  return {
    id: message.id,
    orgId: message.orgId,
    channelId: message.channelId,
    userId: message.userId,
    role: message.role,
    content: message.content,
    parentId: message.parentId,
    createdAt: message.createdAt.toISOString(),
  };
}

export interface CreateChannelRoutesDeps {
  da: ChannelDataAccess;
  /** 미주입이면 @model 멘션이 조용히 무시된다(사람 글은 정상 저장 — fail-soft). */
  provider?: LLMProvider;
  model?: string;
}

export function createChannelRoutes(
  deps: CreateChannelRoutesDeps,
): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  function actorOf(c: { get(key: "auth"): AuthedVariables["auth"] }) {
    const auth = c.get("auth");
    return { userId: auth.sub, orgId: auth.org };
  }

  /** 같은 org 의 채널만 실재로 취급 — 아니면 null(=404). */
  async function channelInOrg(
    orgId: string,
    id: string,
  ): Promise<Channel | null> {
    const found = await deps.da.channels.byId(id);
    if (!found || found.orgId !== orgId) return null;
    return found;
  }

  async function membershipOf(
    channelId: string,
    userId: string,
  ): Promise<ChannelMember | null> {
    const page = await deps.da.channelMembers.list(
      { channelId, userId },
      { limit: BULK_LIMIT },
    );
    return page.items[0] ?? null;
  }

  async function membersOf(channelId: string): Promise<ChannelMember[]> {
    const page = await deps.da.channelMembers.list(
      { channelId },
      { limit: BULK_LIMIT },
    );
    return page.items;
  }

  async function messagesOf(
    orgId: string,
    channelId: string,
    limit: number,
  ): Promise<ChannelMessage[]> {
    const page = await deps.da.channelMessages.list(
      { orgId, channelId },
      { limit },
    );
    return page.items;
  }

  // ─── 채널 CRUD ────────────────────────────────────────────────────────────

  app.get("/", async (c) => {
    const actor = actorOf(c);
    const page = await deps.da.channels.list(
      { orgId: actor.orgId },
      { limit: BULK_LIMIT },
    );
    const data = [];
    for (const channel of page.items) {
      const members = await membersOf(channel.id);
      data.push({
        ...toChannelDto(channel),
        memberCount: members.length,
        isMember: members.some((m) => m.userId === actor.userId),
      });
    }
    return c.json({ data, meta: meta() });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => null)) ?? {};
    if (typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "name 은 비어 있지 않은 문자열이어야 합니다.",
        ),
        400,
      );
    }
    if (
      body.description !== undefined &&
      typeof body.description !== "string"
    ) {
      return c.json(
        errorJson("INVALID_INPUT", "description 은 문자열이어야 합니다."),
        400,
      );
    }

    const actor = actorOf(c);
    const created = await deps.da.channels.insert({
      orgId: actor.orgId,
      name: body.name.trim().slice(0, MAX_NAME_CHARS),
      description: (body.description ?? "").slice(0, MAX_DESCRIPTION_CHARS),
      createdBy: actor.userId,
    });
    // 만든 사람은 곧바로 owner 멤버 — 자기가 만든 방에 다시 가입해야 하는 UX 는 없다.
    await deps.da.channelMembers.insert({
      orgId: actor.orgId,
      channelId: created.id,
      userId: actor.userId,
      role: "owner",
    });
    return c.json(
      {
        data: { ...toChannelDto(created), memberCount: 1, isMember: true },
        meta: meta(),
      },
      201,
    );
  });

  app.get("/:id", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const members = await membersOf(channel.id);
    return c.json({
      data: {
        ...toChannelDto(channel),
        memberCount: members.length,
        isMember: members.some((m) => m.userId === actor.userId),
      },
      meta: meta(),
    });
  });

  app.patch("/:id", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const membership = await membershipOf(channel.id, actor.userId);
    if (membership?.role !== "owner") {
      return c.json(
        errorJson("FORBIDDEN", "채널 소유자만 수정할 수 있습니다."),
        403,
      );
    }
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (body.name !== undefined && typeof body.name !== "string") {
      return c.json(
        errorJson("INVALID_INPUT", "name 은 문자열이어야 합니다."),
        400,
      );
    }
    if (
      body.description !== undefined &&
      typeof body.description !== "string"
    ) {
      return c.json(
        errorJson("INVALID_INPUT", "description 은 문자열이어야 합니다."),
        400,
      );
    }

    const patch: Partial<Channel> = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name === "") {
        return c.json(
          errorJson("INVALID_INPUT", "name 은 비어 있을 수 없습니다."),
          400,
        );
      }
      patch.name = name.slice(0, MAX_NAME_CHARS);
    }
    if (typeof body.description === "string") {
      patch.description = body.description.slice(0, MAX_DESCRIPTION_CHARS);
    }

    const updated = await deps.da.channels.update(channel.id, patch);
    const members = await membersOf(channel.id);
    return c.json({
      data: {
        ...toChannelDto(updated),
        memberCount: members.length,
        isMember: true,
      },
      meta: meta(),
    });
  });

  app.delete("/:id", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const membership = await membershipOf(channel.id, actor.userId);
    if (membership?.role !== "owner") {
      return c.json(
        errorJson("FORBIDDEN", "채널 소유자만 삭제할 수 있습니다."),
        403,
      );
    }
    await deps.da.channels.delete(channel.id);
    return c.body(null, 204);
  });

  // ─── 멤버십 ───────────────────────────────────────────────────────────────

  app.get("/:id/members", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const members = await membersOf(channel.id);
    return c.json({ data: members.map(toMemberDto), meta: meta() });
  });

  app.post("/:id/members", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    // 멱등 — 두 번 눌러도 UNIQUE(channel_id,user_id) 위반으로 500 이 나면 안 된다.
    const existing = await membershipOf(channel.id, actor.userId);
    const membership =
      existing ??
      (await deps.da.channelMembers.insert({
        orgId: actor.orgId,
        channelId: channel.id,
        userId: actor.userId,
        role: "member",
      }));
    return c.json({ data: toMemberDto(membership), meta: meta() }, 201);
  });

  app.delete("/:id/members/me", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    // owner 가 나가도 방은 남긴다 — 방의 대화 기록은 조직 자산이다.
    const membership = await membershipOf(channel.id, actor.userId);
    if (membership) await deps.da.channelMembers.delete(membership.id);
    return c.body(null, 204);
  });

  // ─── 메시지 ───────────────────────────────────────────────────────────────

  app.get("/:id/messages", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const raw = Number.parseInt(c.req.query("limit") ?? "", 10);
    const limit =
      Number.isFinite(raw) && raw > 0
        ? Math.min(raw, MAX_MESSAGE_LIMIT)
        : DEFAULT_MESSAGE_LIMIT;

    const messages = await messagesOf(actor.orgId, channel.id, limit);
    const data = [];
    for (const message of messages) {
      const reactions = await deps.da.channelReactions.list(
        { orgId: actor.orgId, messageId: message.id },
        { limit: BULK_LIMIT },
      );
      // 이모지별 집계 — 삽입 순서를 유지해야 UI 에서 반응 순서가 튀지 않는다.
      const byEmoji = new Map<
        string,
        { emoji: string; count: number; reactedByMe: boolean }
      >();
      for (const reaction of reactions.items) {
        const entry = byEmoji.get(reaction.emoji) ?? {
          emoji: reaction.emoji,
          count: 0,
          reactedByMe: false,
        };
        entry.count += 1;
        if (reaction.userId === actor.userId) entry.reactedByMe = true;
        byEmoji.set(reaction.emoji, entry);
      }
      data.push({ ...toMessageDto(message), reactions: [...byEmoji.values()] });
    }
    return c.json({ data, meta: meta() });
  });

  app.post("/:id/messages", async (c) => {
    const actor = actorOf(c);
    const channel = await channelInOrg(actor.orgId, c.req.param("id"));
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    const membership = await membershipOf(channel.id, actor.userId);
    if (!membership) {
      return c.json(
        errorJson("NOT_A_MEMBER", "채널 멤버만 글을 쓸 수 있습니다."),
        403,
      );
    }

    const body = (await c.req.json().catch(() => null)) ?? {};
    if (typeof body !== "object") {
      return c.json(errorJson("INVALID_INPUT", "본문이 필요합니다."), 400);
    }
    if (typeof body.content !== "string" || body.content.trim() === "") {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "content 는 비어 있지 않은 문자열이어야 합니다.",
        ),
        400,
      );
    }
    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      if (typeof body.parentId !== "string") {
        return c.json(
          errorJson("INVALID_INPUT", "parentId 는 문자열이어야 합니다."),
          400,
        );
      }
      const parent = await deps.da.channelMessages.byId(body.parentId);
      // 다른 채널/다른 org 의 메시지를 부모로 삼아 스레드를 넘나드는 것을 막는다.
      if (
        !parent ||
        parent.channelId !== channel.id ||
        parent.orgId !== actor.orgId
      ) {
        return c.json(
          errorJson(
            "INVALID_INPUT",
            "parentId 가 이 채널의 메시지가 아닙니다.",
          ),
          400,
        );
      }
      parentId = parent.id;
    }

    const content = body.content.trim().slice(0, MAX_CONTENT_CHARS);
    const created = await deps.da.channelMessages.insert({
      orgId: actor.orgId,
      channelId: channel.id,
      userId: actor.userId,
      role: "user",
      content,
      parentId,
    });
    const dto = toMessageDto(created);
    publishChannelEvent(channel.id, { type: "channel_message", message: dto });

    // @model — 실패해도 사람 글은 이미 성공이다(fail-soft). 인라인 await 라 테스트가 결정적.
    if (MODEL_MENTION_RE.test(content)) {
      await replyAsModel(actor.orgId, channel.id, created, c.req.raw.signal);
    }

    return c.json({ data: { ...dto, reactions: [] }, meta: meta() }, 201);
  });

  /**
   * @model 멘션에 대한 assistant 답글을 같은 스레드에 남긴다.
   * 어떤 실패도 밖으로 던지지 않는다 — 호출자는 이미 사람 글 저장에 성공했다.
   */
  async function replyAsModel(
    orgId: string,
    channelId: string,
    trigger: ChannelMessage,
    signal: AbortSignal,
  ): Promise<void> {
    const { provider, model } = deps;
    if (!provider || !model) return;
    try {
      // 스레드 답글이면 그 스레드가, 최상위 글이면 그 글 자신이 루트다.
      const threadRoot = trigger.parentId ?? trigger.id;
      const all = await messagesOf(orgId, channelId, MAX_MESSAGE_LIMIT);
      const thread = all.filter(
        (m) => m.id === threadRoot || m.parentId === threadRoot,
      );
      const context = thread.slice(-MODEL_CONTEXT_MESSAGES);
      const messages: LLMMessage[] = context.map((m) => ({
        role:
          m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));
      if (messages.length === 0) return;

      let text = "";
      for await (const event of provider.chat(
        {
          model,
          systemBlocks: [{ tier: "system", content: CHANNEL_SYSTEM_PROMPT }],
          messages,
          maxTokens: MODEL_MAX_TOKENS,
        },
        signal,
      )) {
        if (event.type === "text_delta") text += event.text;
      }

      const answer = text.trim();
      if (answer === "") return;

      const reply = await deps.da.channelMessages.insert({
        orgId,
        channelId,
        userId: null,
        role: "assistant",
        content: answer.slice(0, MAX_CONTENT_CHARS),
        parentId: threadRoot,
      });
      publishChannelEvent(channelId, {
        type: "channel_message",
        message: toMessageDto(reply),
      });
    } catch {
      // 조용히 포기 — 사람의 글은 남는다.
    }
  }

  // ─── 반응 ─────────────────────────────────────────────────────────────────

  /** 채널 + 멤버십 + 메시지 소속을 한 번에 확인. 실패하면 그대로 응답할 Response 를 준다. */
  async function resolveReactionTarget(
    orgId: string,
    userId: string,
    channelId: string,
    messageId: string,
  ): Promise<
    | { ok: true; message: ChannelMessage }
    | { ok: false; code: string; message: string; status: 403 | 404 }
  > {
    const channel = await channelInOrg(orgId, channelId);
    if (!channel) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "채널을 찾을 수 없습니다.",
        status: 404,
      };
    }
    const membership = await membershipOf(channel.id, userId);
    if (!membership) {
      return {
        ok: false,
        code: "NOT_A_MEMBER",
        message: "채널 멤버만 반응할 수 있습니다.",
        status: 403,
      };
    }
    const message = await deps.da.channelMessages.byId(messageId);
    if (
      !message ||
      message.channelId !== channel.id ||
      message.orgId !== orgId
    ) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "메시지를 찾을 수 없습니다.",
        status: 404,
      };
    }
    return { ok: true, message };
  }

  app.post("/:id/messages/:mid/reactions", async (c) => {
    const actor = actorOf(c);
    const channelId = c.req.param("id");
    const target = await resolveReactionTarget(
      actor.orgId,
      actor.userId,
      channelId,
      c.req.param("mid"),
    );
    if (!target.ok) {
      return c.json(errorJson(target.code, target.message), target.status);
    }

    const body = (await c.req.json().catch(() => null)) ?? {};
    if (typeof body?.emoji !== "string" || body.emoji.trim() === "") {
      return c.json(
        errorJson(
          "INVALID_INPUT",
          "emoji 는 비어 있지 않은 문자열이어야 합니다.",
        ),
        400,
      );
    }
    const emoji = body.emoji.trim().slice(0, MAX_EMOJI_CHARS);

    // 멱등 — DB UNIQUE(message_id,user_id,emoji) 위반으로 500 이 나기 전에 걸러낸다.
    const mine = await deps.da.channelReactions.list(
      {
        orgId: actor.orgId,
        messageId: target.message.id,
        userId: actor.userId,
      },
      { limit: BULK_LIMIT },
    );
    const existing = mine.items.find((r) => r.emoji === emoji);
    const reaction =
      existing ??
      (await deps.da.channelReactions.insert({
        orgId: actor.orgId,
        messageId: target.message.id,
        userId: actor.userId,
        emoji,
      }));
    publishChannelEvent(channelId, {
      type: "channel_reaction",
      messageId: target.message.id,
      emoji,
      userId: actor.userId,
      op: "add",
    });
    return c.json(
      {
        data: {
          id: reaction.id,
          orgId: reaction.orgId,
          messageId: reaction.messageId,
          userId: reaction.userId,
          emoji: reaction.emoji,
          createdAt: reaction.createdAt.toISOString(),
        },
        meta: meta(),
      },
      201,
    );
  });

  app.delete("/:id/messages/:mid/reactions/:emoji", async (c) => {
    const actor = actorOf(c);
    const channelId = c.req.param("id");
    const target = await resolveReactionTarget(
      actor.orgId,
      actor.userId,
      channelId,
      c.req.param("mid"),
    );
    if (!target.ok) {
      return c.json(errorJson(target.code, target.message), target.status);
    }
    const emoji = decodeURIComponent(c.req.param("emoji"));
    const mine = await deps.da.channelReactions.list(
      {
        orgId: actor.orgId,
        messageId: target.message.id,
        userId: actor.userId,
      },
      { limit: BULK_LIMIT },
    );
    // 없으면 그냥 204 — 토글 UX 는 재시도가 안전해야 한다.
    const existing = mine.items.find((r) => r.emoji === emoji);
    if (existing) await deps.da.channelReactions.delete(existing.id);
    publishChannelEvent(channelId, {
      type: "channel_reaction",
      messageId: target.message.id,
      emoji,
      userId: actor.userId,
      op: "remove",
    });
    return c.body(null, 204);
  });

  // ─── SSE ──────────────────────────────────────────────────────────────────
  // routes/notifications.ts 미러 — 봉투 없이 event:<type> + data:JSON 을 relay 한다.

  app.get("/:id/stream", async (c) => {
    const actor = actorOf(c);
    const channelId = c.req.param("id");
    const channel = await channelInOrg(actor.orgId, channelId);
    if (!channel) {
      return c.json(errorJson("NOT_FOUND", "채널을 찾을 수 없습니다."), 404);
    }
    // 리버스 프록시가 SSE 를 버퍼링하지 않게(즉시 전달).
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const subscription = subscribeChannel(channel.id);
      const writePing = () =>
        stream
          .writeSSE({ event: "ping", data: JSON.stringify({ type: "ping" }) })
          .catch(() => {});
      // 연결 즉시 ping 을 한 번 보내 스트림 오픈을 확정(클라이언트 onopen 트리거)한다.
      await writePing();
      const heartbeat = setInterval(() => void writePing(), HEARTBEAT_MS);
      const signal = c.req.raw.signal;
      const onAbort = () => subscription.unsubscribe();
      if (signal.aborted) {
        subscription.unsubscribe();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        for await (const event of subscription.events as AsyncIterable<ChannelEvent>) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } finally {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();
      }
    });
  });

  return app;
}

// channels.test.ts — P22-T6-12 RED: routes/channels.ts 가 없다(실시간 다중사용자 채널 부재).
// 갭 카탈로그 P22-T6-12 acceptance 중 서버측:
//   (1) 채널 생성 → 생성자가 owner 멤버로 자동 등록, 목록에 memberCount/isMember 노출
//   (2) 방은 org 전체에 보이지만 **글쓰기는 멤버만** — 비멤버 POST 는 403 NOT_A_MEMBER,
//       가입(POST /:id/members) 후에는 201
//   (3) cross-org 는 403 이 아니라 404 (notes.ts/agents.ts 와 동일한 existence-leak 방지)
//   (4) 스레드 답글(parentId) 영속, 이모지 반응 집계(count/reactedByMe)와 멱등 토글
//   (5) @model 멘션 → assistant 메시지(userId=null)가 같은 스레드에 저장되고 이벤트가 발행됨
//   (6) provider 미주입/실패 시 fail-soft — 사람 메시지는 반드시 성공한다
//   (7) SSE 버스가 해당 채널 구독자에게만 전달(다른 채널로 누수 없음)
// notes.test.ts 의 fake DA + 주입 auth 패턴.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
  ChannelReaction,
  ChatInput,
  LLMProvider,
  Pagination,
} from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createChannelRoutes } from "../channels.js";
import type { ChannelDataAccess } from "../../db/channel-data-access.js";
import {
  subscribeChannel,
  type ChannelEvent,
} from "../../orchestrator/channel-registry.js";

// ─── fake DataAccess (in-memory) ────────────────────────────────────────────

interface Seed {
  channels?: Channel[];
  members?: ChannelMember[];
  messages?: ChannelMessage[];
  reactions?: ChannelReaction[];
}

function makeDa(seed: Seed = {}): ChannelDataAccess {
  const channels: Channel[] = [...(seed.channels ?? [])];
  const members: ChannelMember[] = [...(seed.members ?? [])];
  const messages: ChannelMessage[] = [...(seed.messages ?? [])];
  const reactions: ChannelReaction[] = [...(seed.reactions ?? [])];

  function paged<T>(rows: T[], pagination?: Pagination) {
    const limit = pagination?.limit ?? 100;
    return { items: rows.slice(0, limit) };
  }

  return {
    channels: {
      async insert(data) {
        const now = new Date();
        const row: Channel = {
          id: randomUUID(),
          orgId: data.orgId as string,
          name: data.name ?? "",
          description: data.description ?? "",
          createdBy: data.createdBy as string,
          createdAt: now,
          updatedAt: now,
        };
        channels.push(row);
        return row;
      },
      async bulkInsert(rows) {
        const out: Channel[] = [];
        for (const r of rows) out.push(await this.insert(r));
        return out;
      },
      async update(id, data) {
        const idx = channels.findIndex((r) => r.id === id);
        const next = {
          ...(channels[idx] as Channel),
          ...data,
          updatedAt: new Date(),
        } as Channel;
        channels[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = channels.findIndex((r) => r.id === id);
        if (idx !== -1) channels.splice(idx, 1);
        // FK ON DELETE CASCADE 흉내
        for (let i = members.length - 1; i >= 0; i--) {
          if (members[i]?.channelId === id) members.splice(i, 1);
        }
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i]?.channelId === id) messages.splice(i, 1);
        }
      },
      async byId(id) {
        return channels.find((r) => r.id === id) ?? null;
      },
      async list(filter, pagination) {
        return paged(
          channels.filter(
            (r) => filter?.orgId === undefined || r.orgId === filter.orgId,
          ),
          pagination,
        );
      },
    },
    channelMembers: {
      async insert(data) {
        const row: ChannelMember = {
          id: randomUUID(),
          orgId: data.orgId as string,
          channelId: data.channelId as string,
          userId: data.userId as string,
          role: data.role ?? "member",
          createdAt: new Date(),
        };
        members.push(row);
        return row;
      },
      async bulkInsert(rows) {
        const out: ChannelMember[] = [];
        for (const r of rows) out.push(await this.insert(r));
        return out;
      },
      async update(id, data) {
        const idx = members.findIndex((r) => r.id === id);
        const next = { ...(members[idx] as ChannelMember), ...data };
        members[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = members.findIndex((r) => r.id === id);
        if (idx !== -1) members.splice(idx, 1);
      },
      async byId(id) {
        return members.find((r) => r.id === id) ?? null;
      },
      async list(filter, pagination) {
        return paged(
          members.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.channelId === undefined ||
                r.channelId === filter.channelId) &&
              (filter?.userId === undefined || r.userId === filter.userId),
          ),
          pagination,
        );
      },
    },
    channelMessages: {
      async insert(data) {
        const row: ChannelMessage = {
          id: randomUUID(),
          orgId: data.orgId as string,
          channelId: data.channelId as string,
          userId: data.userId ?? null,
          role: data.role ?? "user",
          content: data.content ?? "",
          parentId: data.parentId ?? null,
          createdAt: new Date(),
        };
        messages.push(row);
        return row;
      },
      async bulkInsert(rows) {
        const out: ChannelMessage[] = [];
        for (const r of rows) out.push(await this.insert(r));
        return out;
      },
      async update(id, data) {
        const idx = messages.findIndex((r) => r.id === id);
        const next = { ...(messages[idx] as ChannelMessage), ...data };
        messages[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = messages.findIndex((r) => r.id === id);
        if (idx !== -1) messages.splice(idx, 1);
      },
      async byId(id) {
        return messages.find((r) => r.id === id) ?? null;
      },
      async list(filter, pagination) {
        const hasParentKey = filter !== undefined && "parentId" in filter;
        const rows = messages
          .filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.channelId === undefined ||
                r.channelId === filter.channelId) &&
              (!hasParentKey ||
                r.parentId === (filter.parentId as string | null)),
          )
          // pg 구현체와 동일하게 created_at ASC (동률은 삽입 순서 유지 — sort 는 stable)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return paged(rows, pagination);
      },
    },
    channelReactions: {
      async insert(data) {
        const row: ChannelReaction = {
          id: randomUUID(),
          orgId: data.orgId as string,
          messageId: data.messageId as string,
          userId: data.userId as string,
          emoji: data.emoji ?? "",
          createdAt: new Date(),
        };
        reactions.push(row);
        return row;
      },
      async bulkInsert(rows) {
        const out: ChannelReaction[] = [];
        for (const r of rows) out.push(await this.insert(r));
        return out;
      },
      async update(id, data) {
        const idx = reactions.findIndex((r) => r.id === id);
        const next = { ...(reactions[idx] as ChannelReaction), ...data };
        reactions[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = reactions.findIndex((r) => r.id === id);
        if (idx !== -1) reactions.splice(idx, 1);
      },
      async byId(id) {
        return reactions.find((r) => r.id === id) ?? null;
      },
      async list(filter, pagination) {
        return paged(
          reactions.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.messageId === undefined ||
                r.messageId === filter.messageId) &&
              (filter?.userId === undefined || r.userId === filter.userId),
          ),
          pagination,
        );
      },
    },
  };
}

function makeProvider(text = "모델 응답입니다.") {
  const calls: Array<{ input: ChatInput; signal?: AbortSignal }> = [];
  const provider = {
    async *chat(input: ChatInput, signal: AbortSignal) {
      calls.push({ input, signal });
      yield { type: "text_delta" as const, text };
    },
  } as unknown as LLMProvider;
  return { calls, provider };
}

function appWith(
  da: ChannelDataAccess,
  actor: { userId: string; orgId: string },
  provider?: LLMProvider,
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route(
    "/",
    createChannelRoutes({ da, provider, model: "claude-sonnet-5" }),
  );
  return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

function seedChannel(over: Partial<Channel> = {}): Channel {
  const now = new Date();
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    name: "시드 채널",
    description: "",
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function seedMember(over: Partial<ChannelMember> = {}): ChannelMember {
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    channelId: randomUUID(),
    userId: randomUUID(),
    role: "member",
    createdAt: new Date(),
    ...over,
  };
}

async function takeEvents(
  events: AsyncIterable<ChannelEvent>,
  n: number,
): Promise<ChannelEvent[]> {
  const out: ChannelEvent[] = [];
  if (n === 0) return out;
  for await (const e of events) {
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

type MessageDto = {
  id: string;
  userId: string | null;
  role: string;
  content: string;
  parentId: string | null;
  reactions: Array<{ emoji: string; count: number; reactedByMe: boolean }>;
};

let userId: string;
let orgId: string;
let otherOrgId: string;
let otherUserId: string;

beforeEach(() => {
  userId = randomUUID();
  orgId = randomUUID();
  otherOrgId = randomUUID();
  otherUserId = randomUUID();
});

describe("createChannelRoutes — 채널 CRUD/멤버십", () => {
  it("POST / — 201, 생성자가 owner 멤버로 자동 등록되고 목록에 memberCount 1 / isMember true", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "  일반  ", description: "잡담방" }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.name).toBe("일반");
    expect(body.data.orgId).toBe(orgId);
    expect(body.data.createdBy).toBe(userId);
    expect(typeof body.data.createdAt).toBe("string");

    const created = await da.channelMembers.list({
      channelId: body.data.id as string,
    });
    expect(created.items).toHaveLength(1);
    expect(created.items[0]?.userId).toBe(userId);
    expect(created.items[0]?.role).toBe("owner");

    const list = (await (await app.request("/")).json()) as {
      data: Array<{ memberCount: number; isMember: boolean }>;
    };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.memberCount).toBe(1);
    expect(list.data[0]?.isMember).toBe(true);
  });

  it("POST / — name 이 비면 400 INVALID_INPUT", async () => {
    const app = appWith(makeDa(), { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "   " }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("GET / — 다른 org 의 채널은 목록에 없다", async () => {
    const da = makeDa({
      channels: [
        seedChannel({ orgId, name: "우리 방" }),
        seedChannel({ orgId: otherOrgId, name: "남의 방" }),
      ],
    });
    const app = appWith(da, { userId, orgId });
    const body = (await (await app.request("/")).json()) as {
      data: Array<{ name: string; isMember: boolean }>;
    };
    expect(body.data.map((r) => r.name)).toEqual(["우리 방"]);
    expect(body.data[0]?.isMember).toBe(false);
  });

  it("GET /:id — 다른 org 의 채널은 404 (존재를 숨긴다)", async () => {
    const foreign = seedChannel({ orgId: otherOrgId });
    const app = appWith(makeDa({ channels: [foreign] }), { userId, orgId });
    const res = await app.request(`/${foreign.id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("PATCH /:id — owner 는 수정할 수 있다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId, name: "이전" });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${ch.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "이후", description: "설명" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("이후");
    expect((await da.channels.byId(ch.id))?.name).toBe("이후");
  });

  it("PATCH /:id — owner 가 아닌 멤버는 403 FORBIDDEN 이고 원본이 유지된다", async () => {
    const ch = seedChannel({ orgId, createdBy: otherUserId, name: "원본" });
    const da = makeDa({
      channels: [ch],
      members: [
        seedMember({
          orgId,
          channelId: ch.id,
          userId: otherUserId,
          role: "owner",
        }),
        seedMember({ orgId, channelId: ch.id, userId, role: "member" }),
      ],
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${ch.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "침입" }),
    });
    expect(res.status).toBe(403);
    expect((await da.channels.byId(ch.id))?.name).toBe("원본");
  });

  it("PATCH /:id — 다른 org 는 403 이 아니라 404", async () => {
    const foreign = seedChannel({ orgId: otherOrgId, name: "원본" });
    const da = makeDa({ channels: [foreign] });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${foreign.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "침입" }),
    });
    expect(res.status).toBe(404);
    expect((await da.channels.byId(foreign.id))?.name).toBe("원본");
  });

  it("DELETE /:id — owner 는 204, owner 아닌 멤버는 403, 다른 org 는 404", async () => {
    const mine = seedChannel({ orgId, createdBy: userId });
    const theirs = seedChannel({ orgId, createdBy: otherUserId });
    const foreign = seedChannel({ orgId: otherOrgId });
    const da = makeDa({
      channels: [mine, theirs, foreign],
      members: [
        seedMember({ orgId, channelId: mine.id, userId, role: "owner" }),
        seedMember({ orgId, channelId: theirs.id, userId, role: "member" }),
      ],
    });
    const app = appWith(da, { userId, orgId });

    expect(
      (await app.request(`/${mine.id}`, { method: "DELETE" })).status,
    ).toBe(204);
    expect(await da.channels.byId(mine.id)).toBeNull();

    expect(
      (await app.request(`/${theirs.id}`, { method: "DELETE" })).status,
    ).toBe(403);
    expect(await da.channels.byId(theirs.id)).not.toBeNull();

    expect(
      (await app.request(`/${foreign.id}`, { method: "DELETE" })).status,
    ).toBe(404);
    expect(await da.channels.byId(foreign.id)).not.toBeNull();
  });

  it("POST /:id/members — 가입은 멱등이고, DELETE /:id/members/me 로 탈퇴한다", async () => {
    const ch = seedChannel({ orgId, createdBy: otherUserId });
    const da = makeDa({ channels: [ch] });
    const app = appWith(da, { userId, orgId });

    const first = await app.request(`/${ch.id}/members`, { method: "POST" });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as { data: { id: string } };

    const second = await app.request(`/${ch.id}/members`, { method: "POST" });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { data: { id: string } };
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(
      (await da.channelMembers.list({ channelId: ch.id })).items,
    ).toHaveLength(1);

    const members = (await (await app.request(`/${ch.id}/members`)).json()) as {
      data: Array<{ userId: string }>;
    };
    expect(members.data.map((m) => m.userId)).toEqual([userId]);

    const leave = await app.request(`/${ch.id}/members/me`, {
      method: "DELETE",
    });
    expect(leave.status).toBe(204);
    expect(
      (await da.channelMembers.list({ channelId: ch.id })).items,
    ).toHaveLength(0);
  });

  it("POST /:id/members — 다른 org 채널 가입은 404", async () => {
    const foreign = seedChannel({ orgId: otherOrgId });
    const da = makeDa({ channels: [foreign] });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${foreign.id}/members`, { method: "POST" });
    expect(res.status).toBe(404);
    expect((await da.channelMembers.list({})).items).toHaveLength(0);
  });
});

describe("createChannelRoutes — 메시지", () => {
  it("POST /:id/messages — 같은 org 비멤버는 403 NOT_A_MEMBER, 가입 후에는 201", async () => {
    const ch = seedChannel({ orgId, createdBy: otherUserId });
    const da = makeDa({ channels: [ch] });
    const app = appWith(da, { userId, orgId });

    const denied = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "안녕" }),
    });
    expect(denied.status).toBe(403);
    expect(
      ((await denied.json()) as { error: { code: string } }).error.code,
    ).toBe("NOT_A_MEMBER");
    expect(
      (await da.channelMessages.list({ channelId: ch.id })).items,
    ).toHaveLength(0);

    await app.request(`/${ch.id}/members`, { method: "POST" });
    const ok = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "안녕" }),
    });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { data: MessageDto };
    expect(body.data.content).toBe("안녕");
    expect(body.data.role).toBe("user");
    expect(body.data.userId).toBe(userId);
    expect(body.data.parentId).toBeNull();
  });

  it("GET /:id/messages — 비멤버도 읽을 수 있다(방은 org 공개)", async () => {
    const ch = seedChannel({ orgId, createdBy: otherUserId });
    const da = makeDa({ channels: [ch] });
    await da.channelMessages.insert({
      orgId,
      channelId: ch.id,
      userId: otherUserId,
      role: "user",
      content: "먼저 쓴 글",
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${ch.id}/messages`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: MessageDto[] };
    expect(body.data.map((m) => m.content)).toEqual(["먼저 쓴 글"]);
  });

  it("GET /:id/messages — 다른 org 채널은 404", async () => {
    const foreign = seedChannel({ orgId: otherOrgId });
    const app = appWith(makeDa({ channels: [foreign] }), { userId, orgId });
    expect((await app.request(`/${foreign.id}/messages`)).status).toBe(404);
  });

  it("POST /:id/messages — 빈 content 는 400 INVALID_INPUT", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "   " }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_INPUT",
    );
  });

  it("POST /:id/messages — parentId 로 스레드 답글이 저장되고 조회된다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const app = appWith(da, { userId, orgId });

    const root = (await (
      await app.request(`/${ch.id}/messages`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ content: "원글" }),
      })
    ).json()) as { data: MessageDto };

    const reply = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "답글", parentId: root.data.id }),
    });
    expect(reply.status).toBe(201);
    expect(((await reply.json()) as { data: MessageDto }).data.parentId).toBe(
      root.data.id,
    );

    const list = (await (await app.request(`/${ch.id}/messages`)).json()) as {
      data: MessageDto[];
    };
    expect(list.data).toHaveLength(2);
    expect(list.data[1]?.parentId).toBe(root.data.id);
  });

  it("POST /:id/messages — 다른 채널의 parentId 는 400 INVALID_INPUT", async () => {
    const chA = seedChannel({ orgId, createdBy: userId });
    const chB = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [chA, chB],
      members: [
        seedMember({ orgId, channelId: chA.id, userId, role: "owner" }),
        seedMember({ orgId, channelId: chB.id, userId, role: "owner" }),
      ],
    });
    const foreignMsg = await da.channelMessages.insert({
      orgId,
      channelId: chB.id,
      userId,
      role: "user",
      content: "B 의 글",
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${chA.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "답글", parentId: foreignMsg.id }),
    });
    expect(res.status).toBe(400);
  });
});

describe("createChannelRoutes — 반응", () => {
  it("반응 추가 → GET /messages 에 count 1 / reactedByMe true 로 집계, 중복 추가는 멱등, 삭제하면 사라진다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const app = appWith(da, { userId, orgId });
    const msg = (await (
      await app.request(`/${ch.id}/messages`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ content: "반응 대상" }),
      })
    ).json()) as { data: MessageDto };
    const mid = msg.data.id;

    const add = await app.request(`/${ch.id}/messages/${mid}/reactions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ emoji: "👍" }),
    });
    expect(add.status).toBe(201);

    let list = (await (await app.request(`/${ch.id}/messages`)).json()) as {
      data: MessageDto[];
    };
    expect(list.data[0]?.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);

    // 멱등 — 같은 (message,user,emoji) 재추가해도 count 는 1
    const again = await app.request(`/${ch.id}/messages/${mid}/reactions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ emoji: "👍" }),
    });
    expect(again.status).toBe(201);
    list = (await (await app.request(`/${ch.id}/messages`)).json()) as {
      data: MessageDto[];
    };
    expect(list.data[0]?.reactions).toEqual([
      { emoji: "👍", count: 1, reactedByMe: true },
    ]);

    const del = await app.request(
      `/${ch.id}/messages/${mid}/reactions/${encodeURIComponent("👍")}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(204);
    list = (await (await app.request(`/${ch.id}/messages`)).json()) as {
      data: MessageDto[];
    };
    expect(list.data[0]?.reactions).toEqual([]);
  });

  it("반응은 멤버만 — 비멤버는 403 NOT_A_MEMBER", async () => {
    const ch = seedChannel({ orgId, createdBy: otherUserId });
    const da = makeDa({ channels: [ch] });
    const msg = await da.channelMessages.insert({
      orgId,
      channelId: ch.id,
      userId: otherUserId,
      role: "user",
      content: "글",
    });
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${ch.id}/messages/${msg.id}/reactions`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ emoji: "👍" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "NOT_A_MEMBER",
    );
  });
});

describe("createChannelRoutes — @model 협업", () => {
  it("@model 멘션 → assistant 메시지(userId null)가 같은 스레드에 저장되고 channel_message 이벤트가 두 번 발행된다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const { calls, provider } = makeProvider("모델이 답합니다.");
    const app = appWith(da, { userId, orgId }, provider);

    const sub = subscribeChannel(ch.id);
    const res = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "@model 요약해줘" }),
    });
    expect(res.status).toBe(201);
    const human = (await res.json()) as { data: MessageDto };
    expect(human.data.role).toBe("user");

    // LLM 을 실제로 거쳤고 사람 글이 프롬프트에 실렸다.
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.input.messages)).toContain("요약해줘");

    const list = (await (await app.request(`/${ch.id}/messages`)).json()) as {
      data: MessageDto[];
    };
    expect(list.data).toHaveLength(2);
    const assistant = list.data[1];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.userId).toBeNull();
    expect(assistant?.content).toBe("모델이 답합니다.");
    // 스레드 루트는 트리거한 사람 글이어야 한다.
    expect(assistant?.parentId).toBe(human.data.id);

    const events = await takeEvents(sub.events, 2);
    sub.unsubscribe();
    expect(events.map((e) => e.type)).toEqual([
      "channel_message",
      "channel_message",
    ]);
    const second = events[1];
    expect(second?.type === "channel_message" && second.message.role).toBe(
      "assistant",
    );
  });

  it("@model 이지만 provider 미주입이면 fail-soft — 201 이고 사람 글만 남는다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const app = appWith(da, { userId, orgId }); // provider 미주입

    const res = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "@model 있니?" }),
    });
    expect(res.status).toBe(201);
    const rows = (await da.channelMessages.list({ channelId: ch.id })).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe("user");
  });

  it("@model 이고 provider 가 실패해도 fail-soft — 201 이고 사람 글은 남는다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const failing = {
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new Error("upstream down");
      },
    } as unknown as LLMProvider;
    const app = appWith(da, { userId, orgId }, failing);

    const res = await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "@model 실패해봐" }),
    });
    expect(res.status).toBe(201);
    const rows = (await da.channelMessages.list({ channelId: ch.id })).items;
    expect(rows).toHaveLength(1);
  });

  it("@model 이 없으면 LLM 을 호출하지 않는다", async () => {
    const ch = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [ch],
      members: [seedMember({ orgId, channelId: ch.id, userId, role: "owner" })],
    });
    const { calls, provider } = makeProvider();
    const app = appWith(da, { userId, orgId }, provider);
    await app.request(`/${ch.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "이메일 주소는 a@modelrunner.com 이야" }),
    });
    expect(calls).toHaveLength(0);
  });
});

describe("createChannelRoutes — 실시간 버스", () => {
  it("메시지 게시는 해당 채널 구독자에게만 전달된다 (다른 채널 누수 없음)", async () => {
    const chA = seedChannel({ orgId, createdBy: userId });
    const chB = seedChannel({ orgId, createdBy: userId });
    const da = makeDa({
      channels: [chA, chB],
      members: [
        seedMember({ orgId, channelId: chA.id, userId, role: "owner" }),
        seedMember({ orgId, channelId: chB.id, userId, role: "owner" }),
      ],
    });
    const app = appWith(da, { userId, orgId });

    const subA = subscribeChannel(chA.id);
    const subB = subscribeChannel(chB.id);

    await app.request(`/${chA.id}/messages`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "A 채널 글" }),
    });

    const [received] = await takeEvents(subA.events, 1);
    expect(received?.type).toBe("channel_message");
    expect(
      received?.type === "channel_message" && received.message.content,
    ).toBe("A 채널 글");

    // B 는 아무것도 못 받았어야 한다 — 닫으면 즉시 done.
    subB.unsubscribe();
    expect(await takeEvents(subB.events, 1)).toEqual([]);
    subA.unsubscribe();
  });

  it("GET /:id/stream — 다른 org 채널은 404", async () => {
    const foreign = seedChannel({ orgId: otherOrgId });
    const app = appWith(makeDa({ channels: [foreign] }), { userId, orgId });
    const res = await app.request(`/${foreign.id}/stream`);
    expect(res.status).toBe(404);
  });
});

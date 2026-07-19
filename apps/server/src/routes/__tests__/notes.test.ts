// notes.test.ts — P22-T6-17 RED: routes/notes.ts 가 존재하지 않는다(노트 워크스페이스 부재).
// 갭 카탈로그 P22-T6-17 acceptance 중 서버측을 검증한다:
//   (1) POST /notes → 201 + Note 레코드, GET /notes 가 자기 org+소유자 범위로만 목록
//   (2) 남의 노트(다른 org 또는 같은 org 의 다른 사용자)는 GET/PATCH/DELETE 에서 404
//       (agents.ts 와 동일한 existence-leak 방지 패턴)
//   (3) PATCH 로 본문이 갱신되고 재조회 시 유지된다(= 새로고침 후에도 남는 영속성의 서버측 근거)
//   (4) POST /notes/:id/enhance → orchestrator 경유로 개선된 본문을 저장하고 돌려준다
// agents.test.ts 와 동일한 fake DA + 주입 auth 패턴.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { LLMChatInput, LLMProvider, Note } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createNoteRoutes } from "../notes.js";
import type { NoteDataAccess } from "../../db/note-data-access.js";

function makeDa(seed: Note[] = []): NoteDataAccess {
  const rows: Note[] = [...seed];
  return {
    notes: {
      async insert(data) {
        const now = new Date();
        const row: Note = {
          id: randomUUID(),
          orgId: data.orgId as string,
          userId: data.userId as string,
          title: data.title ?? "",
          content: data.content ?? "",
          createdAt: now,
          updatedAt: now,
        };
        rows.push(row);
        return row;
      },
      async bulkInsert(items) {
        const out: Note[] = [];
        for (const item of items) out.push(await this.insert(item));
        return out;
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        const next = {
          ...(rows[idx] as Note),
          ...data,
          updatedAt: new Date(),
        } as Note;
        rows[idx] = next;
        return next;
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.userId === undefined || r.userId === filter.userId),
          ),
        };
      },
    },
  };
}

/**
 * enhance 용 fake LLMProvider — completions.test.ts 의 makeProvider 패턴.
 * calls[] 로 "LLM 이 실제로 호출됐는가 / 무엇을 받았는가" 를 단언한다.
 */
function makeProvider(text = "# 개선된 노트\n\n정리된 본문.") {
  const calls: Array<{ input: LLMChatInput; signal?: AbortSignal }> = [];
  const provider: LLMProvider = {
     
    async *chat(input, signal) {
      calls.push({ input, signal });
      yield { type: "text_delta" as const, text };
    },
  } as unknown as LLMProvider;
  return { calls, provider };
}

function appWith(
  da: NoteDataAccess,
  actor: { userId: string; orgId: string; role?: "member" | "admin" },
  provider?: LLMProvider,
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: actor.userId,
      org: actor.orgId,
      role: actor.role ?? "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", createNoteRoutes({ da, provider, model: "claude-sonnet-5" }));
  return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

function seedNote(over: Partial<Note> = {}): Note {
  const now = new Date();
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    userId: randomUUID(),
    title: "시드 노트",
    content: "시드 본문",
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

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

describe("createNoteRoutes", () => {
  it("POST / — 201 로 Note 레코드를 반환하고 GET / 목록에 나타난다", async () => {
    const da = makeDa();
    const app = appWith(da, { userId, orgId });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: "회의 메모",
        content: "# 회의\n\n- 안건 1",
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.title).toBe("회의 메모");
    expect(body.data.content).toBe("# 회의\n\n- 안건 1");
    expect(body.data.orgId).toBe(orgId);
    expect(body.data.userId).toBe(userId);
    expect(typeof body.data.createdAt).toBe("string");

    const listRes = await app.request("/");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(list.data).toHaveLength(1);
    expect(list.data[0]?.id).toBe(body.data.id);
  });

  it("POST / — 본문 없이도 빈 노트를 만들 수 있다(제목 기본값 부여)", async () => {
    const app = appWith(makeDa(), { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { title: string } };
    expect(body.data.title.trim()).not.toBe("");
  });

  it("POST / — title 이 문자열이 아니면 400 INVALID_INPUT", async () => {
    const app = appWith(makeDa(), { userId, orgId });
    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: 42 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
  });

  it("GET / — 다른 org 의 노트는 목록에 포함되지 않는다", async () => {
    const da = makeDa([
      seedNote({ orgId, userId, title: "내 것" }),
      seedNote({ orgId: otherOrgId, title: "남의 것" }),
    ]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request("/");
    const body = (await res.json()) as { data: Array<{ title: string }> };
    expect(body.data.map((n) => n.title)).toEqual(["내 것"]);
  });

  it("GET / — 같은 org 라도 다른 사용자의 노트는 목록에 포함되지 않는다", async () => {
    const da = makeDa([
      seedNote({ orgId, userId, title: "내 것" }),
      seedNote({ orgId, userId: otherUserId, title: "동료 것" }),
    ]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request("/");
    const body = (await res.json()) as { data: Array<{ title: string }> };
    expect(body.data.map((n) => n.title)).toEqual(["내 것"]);
  });

  it("GET /:id — 남의 노트는 403 이 아니라 404 (존재 자체를 숨긴다)", async () => {
    const foreign = seedNote({ orgId, userId: otherUserId });
    const app = appWith(makeDa([foreign]), { userId, orgId });
    const res = await app.request(`/${foreign.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("PATCH /:id — 본문을 갱신하고 재조회해도 유지된다", async () => {
    const mine = seedNote({ orgId, userId, content: "이전 본문" });
    const app = appWith(makeDa([mine]), { userId, orgId });

    const res = await app.request(`/${mine.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "새 본문", title: "새 제목" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toBe("새 본문");

    const again = await app.request(`/${mine.id}`);
    const reread = (await again.json()) as {
      data: { content: string; title: string };
    };
    expect(reread.data.content).toBe("새 본문");
    expect(reread.data.title).toBe("새 제목");
  });

  it("PATCH /:id — 남의 노트는 404 이고 원본이 바뀌지 않는다", async () => {
    const foreign = seedNote({ orgId, userId: otherUserId, content: "원본" });
    const da = makeDa([foreign]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${foreign.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ content: "침입" }),
    });
    expect(res.status).toBe(404);
    expect((await da.notes.byId(foreign.id))?.content).toBe("원본");
  });

  it("DELETE /:id — 204 로 삭제되고 목록에서 사라진다", async () => {
    const mine = seedNote({ orgId, userId });
    const app = appWith(makeDa([mine]), { userId, orgId });
    const res = await app.request(`/${mine.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);
    const list = (await (await app.request("/")).json()) as { data: unknown[] };
    expect(list.data).toHaveLength(0);
  });

  it("DELETE /:id — 남의 노트는 404 이고 삭제되지 않는다", async () => {
    const foreign = seedNote({ orgId, userId: otherUserId });
    const da = makeDa([foreign]);
    const app = appWith(da, { userId, orgId });
    const res = await app.request(`/${foreign.id}`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await da.notes.byId(foreign.id)).not.toBeNull();
  });

  it("POST /:id/enhance — 개선된 본문을 저장하고 반환한다", async () => {
    const mine = seedNote({ orgId, userId, content: "대충 쓴 초안" });
    const da = makeDa([mine]);
    const { calls, provider } = makeProvider("# 개선본\n\n정리됨.");
    const app = appWith(da, { userId, orgId }, provider);

    const res = await app.request(`/${mine.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toBe("# 개선본\n\n정리됨.");
    // 실제로 LLM 을 거쳤는지 — 원본 본문이 프롬프트에 실려야 한다.
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.input.messages)).toContain("대충 쓴 초안");
    // 그리고 저장까지 됐어야 새로고침 후에도 개선본이 남는다.
    expect((await da.notes.byId(mine.id))?.content).toBe("# 개선본\n\n정리됨.");
  });

  it("POST /:id/enhance — instruction 을 주면 프롬프트에 실린다", async () => {
    const mine = seedNote({ orgId, userId, content: "초안" });
    const { calls, provider } = makeProvider();
    const app = appWith(makeDa([mine]), { userId, orgId }, provider);
    await app.request(`/${mine.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ instruction: "표로 정리해줘" }),
    });
    expect(JSON.stringify(calls[0]?.input.messages)).toContain("표로 정리해줘");
  });

  it("POST /:id/enhance — 남의 노트는 404 이고 LLM 을 호출하지 않는다", async () => {
    const foreign = seedNote({ orgId, userId: otherUserId });
    const { calls, provider } = makeProvider();
    const app = appWith(makeDa([foreign]), { userId, orgId }, provider);
    const res = await app.request(`/${foreign.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("POST /:id/enhance — provider 미주입이면 503 이고 노트는 그대로다", async () => {
    const mine = seedNote({ orgId, userId, content: "그대로" });
    const da = makeDa([mine]);
    const app = appWith(da, { userId, orgId }); // provider 미주입
    const res = await app.request(`/${mine.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
    expect((await da.notes.byId(mine.id))?.content).toBe("그대로");
  });

  it("POST /:id/enhance — provider 가 실패하면 502 이고 노트는 그대로다(자동완성과 달리 fail-soft 아님)", async () => {
    const mine = seedNote({ orgId, userId, content: "그대로" });
    const da = makeDa([mine]);
    const failing = {
      // eslint-disable-next-line require-yield
      async *chat() {
        throw new Error("upstream down");
      },
    } as unknown as LLMProvider;
    const app = appWith(da, { userId, orgId }, failing);
    const res = await app.request(`/${mine.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(502);
    expect((await da.notes.byId(mine.id))?.content).toBe("그대로");
  });

  it("POST /:id/enhance — 취소 시그널이 provider 로 전파된다", async () => {
    const mine = seedNote({ orgId, userId, content: "초안" });
    const { calls, provider } = makeProvider();
    const app = appWith(makeDa([mine]), { userId, orgId }, provider);
    const controller = new AbortController();
    await app.request(`/${mine.id}/enhance`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
      signal: controller.signal,
    });
    const forwarded = calls[0]?.signal;
    expect(forwarded).toBeDefined();
    controller.abort();
    expect(forwarded?.aborted).toBe(true);
  });
});

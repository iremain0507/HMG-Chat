// sessions.test.ts — 16-API-CONTRACT.md § POST /sessions/:id/messages/hitl,
// GET /sessions/:id/hitl/pending 단일 acceptance (P10-T2-02).
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createSessionRoutes,
  type SessionsPort,
  type SessionMessagesPort,
} from "../sessions.js";
import type { SessionWithPin } from "../../db/session-data-access.js";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { hitlBridge } from "../../tools/hitl-manager.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { Message } from "@wchat/interfaces";
import {
  startMessageRun,
  finishMessageRuns,
} from "../../orchestrator/message-run-registry.js";

// P22-T1-05 — GET /:id 단일 세션 조회 테스트용: byId 만 의미있게 구현하고 나머지 SessionsPort
// 메서드는 호출되면 실패하는 스텁으로 채운다(이 라우트는 byId 만 사용).
function stubSessionsPort(
  byId: (id: string) => Promise<SessionWithPin | null>,
): SessionsPort {
  const notUsed = () => {
    throw new Error("not implemented");
  };
  return {
    byId,
    list: notUsed as SessionsPort["list"],
    create: notUsed as SessionsPort["create"],
    updateForOwner: notUsed as SessionsPort["updateForOwner"],
    deleteForOwner: notUsed as SessionsPort["deleteForOwner"],
    togglePinForOwner: notUsed as SessionsPort["togglePinForOwner"],
    toggleArchiveForOwner: notUsed as SessionsPort["toggleArchiveForOwner"],
    search: notUsed as SessionsPort["search"],
  };
}

function sessionRow(over: Partial<SessionWithPin>): SessionWithPin {
  return {
    id: "session-1",
    userId: "user-1",
    projectId: null,
    title: null,
    archivedAt: null,
    pinnedAt: null,
    folderId: null,
    tags: [],
    lastMessageAt: null,
    createdAt: new Date("2026-07-15T00:00:00Z"),
    ...over,
  };
}

// auth.sub 를 세팅한 뒤 createSessionRoutes 를 마운트한 테스트 앱(messages.test.ts 패턴).
function appWithAuth(
  sub: string,
  deps: Parameters<typeof createSessionRoutes>[0],
) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub,
      org: "org-1",
      role: "member",
    } as AuthedVariables["auth"]);
    await next();
  });
  app.route("/", createSessionRoutes(deps));
  return app;
}

describe("routes/sessions — HITL 응답 브리지 (P10-T2-02)", () => {
  it("POST /:id/messages/hitl 은 pending 요청을 approved 로 resolve 하고 delivered:true 를 반환한다", async () => {
    const sessionId = "session-hitl-1";
    const controller = new AbortController();
    const decisionPromise = hitlBridge.askApproval(
      {
        sessionId,
        toolCallId: "call-1",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "위험한 작업",
        timeoutMs: 60_000,
      },
      controller.signal,
    );

    const app = createSessionRoutes();
    const res = await app.request(`/${sessionId}/messages/hitl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolCallId: "call-1",
        decision: "approved",
        modifiedArgs: { x: 2 },
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { delivered: boolean } };
    expect(json.data.delivered).toBe(true);
    expect(await decisionPromise).toEqual({
      kind: "approved",
      modifiedArgs: { x: 2 },
    });
  });

  it("POST /:id/messages/hitl 은 존재하지 않는 toolCallId 에 404 NOT_FOUND 를 반환한다", async () => {
    const app = createSessionRoutes();
    const res = await app.request("/session-hitl-2/messages/hitl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId: "no-such-call", decision: "denied" }),
    });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("POST /:id/messages/hitl 은 이미 처리된 toolCallId 에 410 GONE 을 반환한다", async () => {
    const sessionId = "session-hitl-3";
    const controller = new AbortController();
    const decisionPromise = hitlBridge
      .askApproval(
        {
          sessionId,
          toolCallId: "call-3",
          toolName: "gated_tool",
          args: {},
          rationale: "위험한 작업",
          timeoutMs: 60_000,
        },
        controller.signal,
      )
      .catch(() => {});

    const app = createSessionRoutes();
    const first = await app.request(`/${sessionId}/messages/hitl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId: "call-3", decision: "denied" }),
    });
    expect(first.status).toBe(200);
    await decisionPromise;

    const second = await app.request(`/${sessionId}/messages/hitl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId: "call-3", decision: "denied" }),
    });
    expect(second.status).toBe(410);
    const json = (await second.json()) as { error: { code: string } };
    expect(json.error.code).toBe("GONE");
  });

  it("POST /:id/messages/hitl 은 decision 누락 시 400 INVALID_INPUT 을 반환한다", async () => {
    const app = createSessionRoutes();
    const res = await app.request("/session-hitl-4/messages/hitl", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolCallId: "call-4" }),
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_INPUT");
  });

  it("GET /:id/hitl/pending 은 현재 세션의 pending HITL 요청 목록을 반환한다", async () => {
    const sessionId = "session-hitl-5";
    const controller = new AbortController();
    const decisionPromise = hitlBridge
      .askApproval(
        {
          sessionId,
          toolCallId: "call-5",
          toolName: "gated_tool",
          args: { y: 1 },
          rationale: "위험한 작업",
          timeoutMs: 60_000,
        },
        controller.signal,
      )
      .catch(() => {});

    const app = createSessionRoutes();
    const res = await app.request(`/${sessionId}/hitl/pending`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ toolCallId: string; toolName: string }>;
    };
    expect(json.data).toEqual([
      expect.objectContaining({ toolCallId: "call-5", toolName: "gated_tool" }),
    ]);

    // 정리 — pending 을 남기지 않는다.
    controller.abort();
    await decisionPromise;
  });
});

describe("routes/sessions — GET /:id/artifacts (P10-T2-04)", () => {
  it("세션에 생성된 artifact 목록을 반환한다", async () => {
    const now = new Date("2026-07-15T00:00:00Z");
    const artifactDa: ArtifactDataAccess = {
      artifacts: {
        async insert() {
          throw new Error("not implemented");
        },
        async bulkInsert() {
          return [];
        },
        async update() {
          throw new Error("not implemented");
        },
        async delete() {},
        async byId() {
          return null;
        },
        async list(filter) {
          if (filter?.sessionId !== "session-art-1") {
            return { items: [] };
          }
          return {
            items: [
              {
                id: "artifact-1",
                sessionId: "session-art-1",
                createdBy: "user-1",
                type: "markdown",
                filename: "notes.md",
                mimeType: null,
                sizeBytes: 4,
                storageKind: "inline",
                s3Key: null,
                inlineContent: null,
                sharedAt: null,
                createdAt: now,
              },
            ],
          };
        },
      },
    };

    const app = createSessionRoutes({ artifactDa });
    const res = await app.request("/session-art-1/artifacts");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<{ id: string; filename: string; type: string }>;
    };
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      id: "artifact-1",
      filename: "notes.md",
      type: "markdown",
    });
  });

  it("artifact 가 없는 세션은 빈 배열을 반환한다", async () => {
    const artifactDa: ArtifactDataAccess = {
      artifacts: {
        async insert() {
          throw new Error("not implemented");
        },
        async bulkInsert() {
          return [];
        },
        async update() {
          throw new Error("not implemented");
        },
        async delete() {},
        async byId() {
          return null;
        },
        async list() {
          return { items: [] };
        },
      },
    };

    const app = createSessionRoutes({ artifactDa });
    const res = await app.request("/session-empty/artifacts");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: unknown[] };
    expect(json.data).toEqual([]);
  });
});

function messageRow(over: Partial<Message>): Message {
  return {
    id: "m-1",
    sessionId: "src",
    role: "user",
    content: "hi",
    toolCallIds: [],
    parentMessageId: null,
    tokensIn: null,
    tokensOut: null,
    costMicros: null,
    createdAt: new Date("2026-07-15T00:00:00Z"),
    ...over,
  };
}

describe("routes/sessions — GET /:id/messages resume 발견(activeRun)", () => {
  function historyApp(sub: string, sessionId: string, sessionUserId: string) {
    const sessions = stubSessionsPort(async (id) =>
      id === sessionId
        ? sessionRow({ id: sessionId, userId: sessionUserId })
        : null,
    );
    const sessionMessages: SessionMessagesPort = {
      list: async () => ({ items: [] }),
      byId: async () => null,
      delete: async () => {},
      insert: (() => {
        throw new Error("not implemented");
      }) as SessionMessagesPort["insert"],
    };
    return appWithAuth(sub, { sessions, sessionMessages });
  }

  it("진행 중(비종결) run 이 있으면 activeRun.messageId 를 실어 준다(새로고침 resume 발견)", async () => {
    await finishMessageRuns(["msg-live-1"], "sess-live"); // 잔여 상태 정리
    await startMessageRun("msg-live-1", "sess-live");
    const app = historyApp("user-1", "sess-live", "user-1");
    const res = await app.request("/sess-live/messages");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { activeRun?: { messageId: string } };
    expect(json.activeRun).toEqual({ messageId: "msg-live-1" });
    await finishMessageRuns(["msg-live-1"], "sess-live");
  });

  it("진행 중 run 이 없으면 activeRun 필드가 없다", async () => {
    await finishMessageRuns(["msg-idle-x"], "sess-idle");
    const app = historyApp("user-1", "sess-idle", "user-1");
    const res = await app.request("/sess-idle/messages");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { activeRun?: unknown };
    expect(json.activeRun).toBeUndefined();
  });
});

describe("routes/sessions — POST /:id/clone 대화 복제 (P22-T6-01)", () => {
  interface CloneHarness {
    app: ReturnType<typeof appWithAuth>;
    inserted: Array<{ sessionId: string; parentMessageId: string | null }>;
    created: Array<{ userId: string; title: string | null }>;
  }

  function cloneApp(opts: {
    sub: string;
    source: SessionWithPin | null;
    messages: Message[];
  }): CloneHarness {
    const inserted: CloneHarness["inserted"] = [];
    const created: CloneHarness["created"] = [];
    let seq = 0;
    const sessions: SessionsPort = {
      byId: async (id) =>
        opts.source && opts.source.id === id ? opts.source : null,
      create: async (data) => {
        created.push({ userId: data.userId, title: data.title ?? null });
        return sessionRow({
          id: "cloned-session",
          userId: data.userId,
          title: data.title ?? null,
          projectId: data.projectId ?? null,
        });
      },
      list: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["list"],
      updateForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["updateForOwner"],
      deleteForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["deleteForOwner"],
      togglePinForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["togglePinForOwner"],
      toggleArchiveForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["toggleArchiveForOwner"],
      search: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["search"],
    };
    const sessionMessages: SessionMessagesPort = {
      list: async (filter) =>
        filter.sessionId === "src" ? { items: opts.messages } : { items: [] },
      byId: async () => null,
      delete: async () => {},
      insert: async (data) => {
        seq += 1;
        const newId = `new-m-${seq}`;
        inserted.push({
          sessionId: data.sessionId as string,
          parentMessageId: (data.parentMessageId as string | null) ?? null,
        });
        return messageRow({
          id: newId,
          sessionId: data.sessionId as string,
          parentMessageId: (data.parentMessageId as string | null) ?? null,
        });
      },
    };
    return {
      app: appWithAuth(opts.sub, { sessions, sessionMessages }),
      inserted,
      created,
    };
  }

  it("소유자가 복제하면 201 + 새 세션 id 를 반환하고 메시지 트리(parentMessageId)를 재매핑해 복사한다", async () => {
    const source = sessionRow({
      id: "src",
      userId: "user-1",
      title: "원본 대화",
      projectId: "proj-1",
    });
    const messages = [
      messageRow({ id: "m1", parentMessageId: null }),
      messageRow({ id: "m2", parentMessageId: "m1" }),
      messageRow({ id: "m3", parentMessageId: "m2" }),
    ];
    const h = cloneApp({ sub: "user-1", source, messages });
    const res = await h.app.request("/src/clone", { method: "POST" });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; title: string | null; projectId: string | null };
    };
    expect(json.data.id).toBe("cloned-session");
    expect(json.data.title).toBe("원본 대화");
    expect(json.data.projectId).toBe("proj-1");
    // 3건이 새 세션(cloned-session)에 삽입되고 parentMessageId 가 new id 로 재매핑된다.
    expect(h.inserted).toEqual([
      { sessionId: "cloned-session", parentMessageId: null },
      { sessionId: "cloned-session", parentMessageId: "new-m-1" },
      { sessionId: "cloned-session", parentMessageId: "new-m-2" },
    ]);
  });

  it("타 사용자 소유 세션 복제는 404 이고 새 세션을 만들지 않는다(cross-owner 차단)", async () => {
    const source = sessionRow({ id: "src", userId: "user-2" });
    const h = cloneApp({ sub: "user-1", source, messages: [] });
    const res = await h.app.request("/src/clone", { method: "POST" });
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
    expect(h.created).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
  });

  it("메시지가 없는 세션도 201 로 빈 새 세션을 만든다", async () => {
    const source = sessionRow({ id: "src", userId: "user-1", title: null });
    const h = cloneApp({ sub: "user-1", source, messages: [] });
    const res = await h.app.request("/src/clone", { method: "POST" });
    expect(res.status).toBe(201);
    expect(h.created).toHaveLength(1);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("routes/sessions — POST /import 대화 가져오기 (P22-T6-13, 계약배치 C9)", () => {
  interface ImportHarness {
    app: ReturnType<typeof appWithAuth>;
    created: Array<{ userId: string; title: string | null }>;
    inserted: Array<{
      sessionId: string;
      role: string;
      content: unknown;
    }>;
  }

  function importApp(sub: string): ImportHarness {
    const created: ImportHarness["created"] = [];
    const inserted: ImportHarness["inserted"] = [];
    let seq = 0;
    const sessions: SessionsPort = {
      byId: async () => null,
      create: async (data) => {
        seq += 1;
        created.push({ userId: data.userId, title: data.title ?? null });
        return sessionRow({
          id: `imported-${seq}`,
          userId: data.userId,
          title: data.title ?? null,
          projectId: data.projectId ?? null,
        });
      },
      list: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["list"],
      updateForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["updateForOwner"],
      deleteForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["deleteForOwner"],
      togglePinForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["togglePinForOwner"],
      toggleArchiveForOwner: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["toggleArchiveForOwner"],
      search: (() => {
        throw new Error("not implemented");
      }) as SessionsPort["search"],
    };
    const sessionMessages: SessionMessagesPort = {
      list: async () => ({ items: [] }),
      byId: async () => null,
      delete: async () => {},
      insert: async (data) => {
        inserted.push({
          sessionId: data.sessionId as string,
          role: data.role as string,
          content: data.content,
        });
        return messageRow({
          id: `im-${inserted.length}`,
          sessionId: data.sessionId as string,
        });
      },
    };
    return {
      app: appWithAuth(sub, { sessions, sessionMessages }),
      created,
      inserted,
    };
  }

  function post(app: ImportHarness["app"], body: unknown) {
    return app.request("/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("native 내보내기 payload 를 201 + createdSessionIds 로 가져오고 메시지를 순서대로 저장한다", async () => {
    const h = importApp("user-1");
    const res = await post(h.app, {
      format: "native",
      payload: {
        title: "가져온 대화",
        messages: [
          { role: "user", content: "안녕" },
          { role: "assistant", content: "반가워요" },
        ],
      },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { createdSessionIds: string[] };
      meta: { requestId: string };
    };
    expect(json.data.createdSessionIds).toEqual(["imported-1"]);
    expect(h.created).toEqual([{ userId: "user-1", title: "가져온 대화" }]);
    expect(h.inserted).toEqual([
      { sessionId: "imported-1", role: "user", content: "안녕" },
      { sessionId: "imported-1", role: "assistant", content: "반가워요" },
    ]);
  });

  it("ChatGPT conversations.json 은 대화마다 세션 1개를 만들고 mapping 을 평탄화한다", async () => {
    const h = importApp("user-1");
    const res = await post(h.app, {
      format: "chatgpt",
      payload: [
        {
          title: "첫 대화",
          mapping: {
            root: { id: "root", message: null, parent: null, children: ["a"] },
            a: {
              id: "a",
              parent: "root",
              children: ["b"],
              message: {
                author: { role: "user" },
                content: { content_type: "text", parts: ["질문"] },
              },
            },
            b: {
              id: "b",
              parent: "a",
              children: [],
              message: {
                author: { role: "assistant" },
                content: { content_type: "text", parts: ["답변"] },
              },
            },
          },
        },
        {
          title: "둘째 대화",
          mapping: {
            c: {
              id: "c",
              parent: null,
              children: [],
              message: {
                author: { role: "user" },
                content: { content_type: "text", parts: ["혼잣말"] },
              },
            },
          },
        },
      ],
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { createdSessionIds: string[] };
    };
    expect(json.data.createdSessionIds).toEqual(["imported-1", "imported-2"]);
    expect(h.created.map((c) => c.title)).toEqual(["첫 대화", "둘째 대화"]);
    expect(h.inserted).toEqual([
      { sessionId: "imported-1", role: "user", content: "질문" },
      { sessionId: "imported-1", role: "assistant", content: "답변" },
      { sessionId: "imported-2", role: "user", content: "혼잣말" },
    ]);
  });

  it("payload 안의 userId 는 무시하고 항상 auth.sub 소유로 만든다(cross-org/cross-user 격리)", async () => {
    const h = importApp("user-1");
    const res = await post(h.app, {
      format: "native",
      payload: {
        title: "남의 대화",
        userId: "user-2",
        orgId: "org-2",
        messages: [{ role: "user", content: "x" }],
      },
    });
    expect(res.status).toBe(201);
    expect(h.created).toEqual([{ userId: "user-1", title: "남의 대화" }]);
  });

  it("잘못된 format 이나 파싱 불가 payload 는 400 INVALID_INPUT 이고 세션을 만들지 않는다", async () => {
    const h = importApp("user-1");
    const bad = await post(h.app, { format: "gemini", payload: {} });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
      "INVALID_INPUT",
    );
    const unparsable = await post(h.app, {
      format: "native",
      payload: { x: 1 },
    });
    expect(unparsable.status).toBe(400);
    expect(h.created).toHaveLength(0);
    expect(h.inserted).toHaveLength(0);
  });
});

describe("routes/sessions — GET /:id 단일 세션 조회 (P22-T1-05, 16-API-CONTRACT §432)", () => {
  it("소유자는 200 과 {id,title,projectId,createdAt,archivedAt} + meta.requestId 를 받는다", async () => {
    const createdAt = new Date("2026-07-15T00:00:00Z");
    const archivedAt = new Date("2026-07-16T00:00:00Z");
    const app = appWithAuth("user-1", {
      sessions: stubSessionsPort(async (id) =>
        id === "session-1"
          ? sessionRow({
              id: "session-1",
              userId: "user-1",
              title: "내 세션",
              projectId: "proj-1",
              createdAt,
              archivedAt,
            })
          : null,
      ),
    });
    const res = await app.request("/session-1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        title: string | null;
        projectId: string | null;
        createdAt: string;
        archivedAt: string | null;
      };
      meta: { requestId: string };
    };
    expect(json.data).toEqual({
      id: "session-1",
      title: "내 세션",
      projectId: "proj-1",
      createdAt: createdAt.toISOString(),
      archivedAt: archivedAt.toISOString(),
    });
    expect(json.meta.requestId).toMatch(/[0-9a-f-]{36}/);
  });

  it("아카이브되지 않은 세션의 archivedAt 은 null 이다", async () => {
    const app = appWithAuth("user-1", {
      sessions: stubSessionsPort(async () =>
        sessionRow({ id: "session-1", userId: "user-1", archivedAt: null }),
      ),
    });
    const res = await app.request("/session-1");
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { archivedAt: string | null } };
    expect(json.data.archivedAt).toBeNull();
  });

  it("타 사용자 소유 세션은 404 NOT_FOUND(존재 누출 방지)", async () => {
    const app = appWithAuth("user-1", {
      sessions: stubSessionsPort(async (id) =>
        id === "session-1"
          ? sessionRow({ id: "session-1", userId: "user-2" })
          : null,
      ),
    });
    const res = await app.request("/session-1");
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("존재하지 않는 세션은 타 사용자 세션과 동일한 404 본문을 반환한다(존재 누출 방지)", async () => {
    const notFoundApp = appWithAuth("user-1", {
      sessions: stubSessionsPort(async () => null),
    });
    const crossOrgApp = appWithAuth("user-1", {
      sessions: stubSessionsPort(async () =>
        sessionRow({ id: "session-1", userId: "user-2" }),
      ),
    });
    const nfRes = await notFoundApp.request("/does-not-exist");
    const coRes = await crossOrgApp.request("/session-1");
    expect(nfRes.status).toBe(404);
    expect(coRes.status).toBe(404);
    expect(await nfRes.json()).toEqual(await coRes.json());
  });
});

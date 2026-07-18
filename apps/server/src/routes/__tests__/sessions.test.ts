// sessions.test.ts — 16-API-CONTRACT.md § POST /sessions/:id/messages/hitl,
// GET /sessions/:id/hitl/pending 단일 acceptance (P10-T2-02).
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { createSessionRoutes, type SessionsPort } from "../sessions.js";
import type { SessionWithPin } from "../../db/session-data-access.js";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { hitlBridge } from "../../tools/hitl-manager.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";

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

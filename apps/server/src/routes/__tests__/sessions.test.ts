// sessions.test.ts — 16-API-CONTRACT.md § POST /sessions/:id/messages/hitl,
// GET /sessions/:id/hitl/pending 단일 acceptance (P10-T2-02).
import { describe, it, expect } from "vitest";
import { createSessionRoutes } from "../sessions.js";
import { hitlBridge } from "../../tools/hitl-manager.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";

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

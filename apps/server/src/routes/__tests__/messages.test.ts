import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type {
  AgentTool,
  ChatEvent,
  LLMProvider,
  PromptBlock,
} from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { listPendingHitl, resolveHitl } from "../../tools/hitl-manager.js";
import { createMessageRoutes, type AttachmentsPort } from "../messages.js";

function fakeHelloProvider(): LLMProvider {
  return {
    name: "fake",
    models: ["fake-model"],
    async *chat() {
      const events: ChatEvent[] = [
        {
          type: "message_start",
          messageId: "msg-1",
          meta: { provider: "fake", model: "fake-model" },
        },
        { type: "text_delta", text: "hello" },
        {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        },
      ];
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe("POST /:id/messages (SSE) — 16-API-CONTRACT § /sessions/:id/messages", () => {
  it("첫 메시지 시 ensureSession(sessionId, userId) 으로 세션을 보장한다(아티팩트 FK 대비)", async () => {
    const ensured: Array<{ id: string; userId: string }> = [];
    const app = new Hono<{ Variables: AuthedVariables }>();
    app.use("*", async (c, next) => {
      c.set("auth", {
        sub: "user-1",
        org: "org-1",
        role: "member",
      } as AuthedVariables["auth"]);
      await next();
    });
    app.route(
      "/",
      createMessageRoutes({
        provider: fakeHelloProvider(),
        model: "fake-model",
        ensureSession: async (id, userId) => {
          ensured.push({ id, userId });
        },
      }),
    );
    const res = await app.request("/sess-abc/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(ensured).toEqual([{ id: "sess-abc", userId: "user-1" }]);
  });

  it("'hello' 메시지를 보내면 SSE 로 text_delta + stop 이 순서대로 온다", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ content: "hello" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    // 프록시 버퍼링 방지 — SSE 토큰을 순차 전달(gzip/버퍼링으로 한 번에 뿌리는 회귀 가드).
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const text = await res.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: text_delta");
    expect(text).toContain('"text":"hello"');
    expect(text).toContain("event: stop");
    expect(text).toContain('"reason":"end_turn"');

    const textDeltaIdx = text.indexOf("event: text_delta");
    const stopIdx = text.indexOf("event: stop");
    expect(textDeltaIdx).toBeGreaterThan(-1);
    expect(stopIdx).toBeGreaterThan(textDeltaIdx);
  });

  it("content 가 빈 문자열이면 400 INVALID_INPUT", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "" }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("INVALID_INPUT");
  });

  it("attachments 에 uploadId 가 있어도 400 이 아니다 (P10-T2-06 — Phase 2/4 boundary 조기 해제)", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        content: "hi",
        attachments: [{ uploadId: "u1" }],
      }),
    });

    expect(res.status).toBe(200);
    await res.text();
  });

  it("attachments 의 uploadId 가 ephemeral 컨텍스트로 turn 의 system 블록에 반영된다", async () => {
    const capturedSystemBlocks: PromptBlock[][] = [];
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat(req) {
        capturedSystemBlocks.push(req.systemBlocks);
        const events: ChatEvent[] = [
          {
            type: "message_start",
            messageId: "msg-attach-1",
            meta: { provider: "fake", model: "fake-model" },
          },
          { type: "text_delta", text: "ok" },
          {
            type: "stop",
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ];
        for (const event of events) yield event;
      },
    };
    const attachments: AttachmentsPort = {
      async resolveEphemeralContext(uploadId) {
        expect(uploadId).toBe("u1");
        return { filename: "spec.pdf" };
      },
    };
    const app = createMessageRoutes({
      provider,
      model: "fake-model",
      attachments,
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        content: "hi",
        attachments: [{ uploadId: "u1" }],
      }),
    });
    await res.text();

    expect(capturedSystemBlocks).toHaveLength(1);
    const blockText = capturedSystemBlocks[0].map((b) => b.content).join("\n");
    expect(blockText).toContain("spec.pdf");
  });
});

describe("GET /:id/messages/:messageId/stream (resume) — 16-API-CONTRACT § resume", () => {
  it("모르는 messageId 는 404 NOT_FOUND", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request(
      "/session-1/messages/unknown-message-id/stream",
    );
    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("이미 terminal 로 종료된 messageId 는 410 GONE", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const postRes = await app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    await postRes.text();

    const res = await app.request("/session-1/messages/msg-1/stream");
    expect(res.status).toBe(410);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("GONE");
  });

  it("재연결 시 message_replace 로 누적 content 를 먼저 받고 이어지는 이벤트를 계속 받는다", async () => {
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        const events: ChatEvent[] = [
          {
            type: "message_start",
            messageId: "msg-resume-1",
            meta: { provider: "fake", model: "fake-model" },
          },
          { type: "text_delta", text: "hello " },
        ];
        for (const event of events) yield event;
        await gate;
        yield { type: "text_delta", text: "world" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const app = createMessageRoutes({ provider, model: "fake-model" });

    const postPromise = app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const resumeRes = await app.request(
      "/session-1/messages/msg-resume-1/stream",
    );
    expect(resumeRes.status).toBe(200);

    resolveGate();
    const [resumeText] = await Promise.all([
      resumeRes.text(),
      postPromise.then((r) => r.text()),
    ]);

    const replaceIdx = resumeText.indexOf("event: message_replace");
    expect(replaceIdx).toBe(0);
    expect(resumeText).toContain('"contentSoFar":"hello "');

    const worldIdx = resumeText.indexOf('"text":"world"');
    expect(worldIdx).toBeGreaterThan(replaceIdx);
    expect(resumeText).toContain("event: stop");
  });

  it("동일 messageId 에 이미 다른 구독자가 있으면 409 CONCURRENT_RUN", async () => {
    let resolveGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const provider: LLMProvider = {
      name: "fake",
      models: ["fake-model"],
      async *chat() {
        yield {
          type: "message_start",
          messageId: "msg-conflict-1",
          meta: { provider: "fake", model: "fake-model" },
        };
        yield { type: "text_delta", text: "hi" };
        await gate;
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const app = createMessageRoutes({ provider, model: "fake-model" });

    const postPromise = app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const firstRes = await app.request(
      "/session-1/messages/msg-conflict-1/stream",
    );
    expect(firstRes.status).toBe(200);

    const secondRes = await app.request(
      "/session-1/messages/msg-conflict-1/stream",
    );
    expect(secondRes.status).toBe(409);
    const json = (await secondRes.json()) as { error: { code: string } };
    expect(json.error.code).toBe("CONCURRENT_RUN");

    resolveGate();
    await Promise.all([firstRes.text(), postPromise.then((r) => r.text())]);
  });
});

describe("POST /:id/messages — tools/toolContext 배선 — P11-T2-02", () => {
  function fakeToolTriggerProvider(toolCallId: string): LLMProvider {
    return {
      name: "fake",
      models: ["fake-model"],
      async *chat(input) {
        const last = input.messages.at(-1);
        if (last?.role === "tool") {
          yield {
            type: "message_start",
            messageId: "msg-hitl-done",
            meta: { provider: "fake", model: "fake-model" },
          };
          yield { type: "text_delta", text: "done" };
          yield {
            type: "stop",
            reason: "end_turn",
            usage: { inputTokens: 1, outputTokens: 1 },
          };
          return;
        }
        yield {
          type: "message_start",
          messageId: "msg-hitl-1",
          meta: { provider: "fake", model: "fake-model" },
        };
        yield {
          type: "tool_use",
          toolCallId,
          name: "danger_tool",
          args: { x: 1 },
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 0 },
        };
      },
    };
  }

  function appWithAuth(routes: ReturnType<typeof createMessageRoutes>) {
    const app = new Hono<{ Variables: AuthedVariables }>();
    app.use("*", async (c, next) => {
      c.set("auth", {
        sub: "user-1",
        org: "org-1",
        role: "member",
        scope: "access",
        jti: "x",
      });
      await next();
    });
    app.route("/", routes);
    return app;
  }

  it("hitl 정책 툴은 승인 전까지 tool_result 를 emit 하지 않고, 승인 후에만 실행 결과를 emit 한다", async () => {
    // app.request() 의 Promise<Response>/res.text() 는 SSE 스트림이 끝까지 완료돼야
    // resolve 되므로(기존 "동일 messageId 에 이미 다른 구독자가 있으면 409" 테스트와 동일한
    // 제약), 같은 요청 안에서 미리 승인해두는 대신 실 hitlBridge 싱글턴(deps.hitl 미지정 시
    // 기본값)의 GET-등가 조회(listPendingHitl)로 hitl_request 가 실제로 등록됐는지 폴링해
    // "승인 전 미실행" 을 검증한 뒤, resolveHitl 로 승인해 완료된 응답을 받는다.
    const sessionId = `session-hitl-${randomUUID()}`;
    const toolCallId = randomUUID();

    const dangerTool: AgentTool = {
      spec: {
        name: "danger_tool",
        description: "위험한 툴 — 승인 필요",
        inputSchema: { type: "object" },
        permissionTier: "tool",
        defaultPolicy: "hitl",
      },
      async invoke({ toolCallId: id }) {
        return { toolCallId: id, content: { kind: "text", text: "실행됨" } };
      },
    };

    const routes = createMessageRoutes({
      provider: fakeToolTriggerProvider(toolCallId),
      model: "fake-model",
      tools: [dangerTool],
    });
    const app = appWithAuth(routes);

    // streamSSE 의 응답 body 는 pull 기반이라, 실제로 body 를 읽기 시작해야만(fetch 소비)
    // runTurn 의 async generator 가 hitl_request 지점까지 진행한다 — 그래서 body 소비를
    // 한 번만(textPromise) 즉시 시작해두고, 그 사이 listPendingHitl 로 등록 여부를 폴링한다.
    const textPromise = app
      .request(`/${sessionId}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ content: "hi" }),
      })
      .then((r) => {
        expect(r.status).toBe(200);
        return r.text();
      });

    let pending = listPendingHitl(sessionId);
    for (let i = 0; i < 50 && pending.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      pending = listPendingHitl(sessionId);
    }
    // 승인 전 — 실행 결과가 아직 큐에 대기 중이어야 한다(=아직 실행되지 않음).
    expect(pending).toHaveLength(1);
    expect(pending[0].toolName).toBe("danger_tool");
    expect(pending[0].toolCallId).toBe(toolCallId);

    const resolveResult = resolveHitl(sessionId, toolCallId, {
      decision: "approved",
    });
    expect(resolveResult).toBe("resolved");

    const text = await textPromise;

    expect(text).toContain("event: hitl_request");
    expect(text).toContain("event: hitl_resolved");
    expect(text).toContain("event: tool_result");
    expect(text).toContain('"실행됨"');

    const hitlRequestIdx = text.indexOf("event: hitl_request");
    const toolResultIdx = text.indexOf("event: tool_result");
    expect(toolResultIdx).toBeGreaterThan(hitlRequestIdx);
  });

  it("tools 미주입 시 기존 동작(auth 없이도 200) 이 그대로 유지된다", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(res.status).toBe(200);
    await res.text();
  });
});

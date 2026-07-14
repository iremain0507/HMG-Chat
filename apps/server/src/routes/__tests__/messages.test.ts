import { describe, it, expect } from "vitest";
import type { ChatEvent, LLMProvider, PromptBlock } from "@wchat/interfaces";
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

import { describe, it, expect } from "vitest";
import type { ChatEvent, LLMProvider } from "@wchat/interfaces";
import { createMessageRoutes } from "../messages.js";

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

  it("attachments 가 비어있지 않으면 400 ATTACHMENTS_NOT_SUPPORTED (Phase 2/4 boundary — 16-API-CONTRACT § POST /sessions/:id/messages)", async () => {
    const app = createMessageRoutes({
      provider: fakeHelloProvider(),
      model: "fake-model",
    });

    const res = await app.request("/session-1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "hi",
        attachments: [{ uploadId: "u1" }],
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe("ATTACHMENTS_NOT_SUPPORTED");
  });
});

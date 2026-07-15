// abort.test.ts — 08-SPRINT-PLAN.md § Phase 2 abort flow (L06) 단일 acceptance:
// "abort signal 전파 시 LLM 호출 cancel; Stop 클릭 시 active_runs.status=cancelled"
// (14-INTERFACES.md § Abort 의무 L06, 16-API-CONTRACT.md § DELETE /sessions/:id/active-run)
import { describe, it, expect } from "vitest";
import type {
  ActiveRunStatus,
  ChatEvent,
  LLMProvider,
} from "@wchat/interfaces";
import { createMessageRoutes } from "../messages.js";
import { createSessionRoutes } from "../sessions.js";

// 09-TDD-GUIDE.md § llm.mock.ts 행동 명세: "abort signal 검출 시 즉시
// { type: 'stop', reason: 'aborted' } 발행" 을 그대로 재현하는 fake provider.
function createHangingProvider(): LLMProvider {
  return {
    name: "fake",
    models: ["fake-model"],
    async *chat(_input, signal) {
      const start: ChatEvent = {
        type: "message_start",
        messageId: "msg-1",
        meta: { provider: "fake", model: "fake-model" },
      };
      yield start;
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      const stop: ChatEvent = {
        type: "stop",
        reason: signal.aborted ? "aborted" : "end_turn",
        usage: { inputTokens: 1, outputTokens: 0 },
      };
      yield stop;
    },
  };
}

describe("abort flow (L06) — P2-T2-05", () => {
  it("DELETE /:id/active-run 호출 시 진행 중이던 LLM 호출이 abort 되어 stop reason=aborted 로 종료되고 active_runs.status=cancelled 로 기록된다", async () => {
    const sessionId = "session-abort-1";
    const recordedStatuses: ActiveRunStatus[] = [];
    const messageApp = createMessageRoutes({
      provider: createHangingProvider(),
      model: "fake-model",
      activeRuns: {
        async setActiveRun(_sessionId, _jobId, status) {
          recordedStatuses.push(status);
        },
      },
    });
    const sessionApp = createSessionRoutes();

    const postPromise = messageApp.request(`/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello" }),
    });

    // 핸들러가 run 을 등록하고 provider.chat 이 abort signal 대기 상태로 들어갈 때까지 tick 양보.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const deleteRes = await sessionApp.request(`/${sessionId}/active-run`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
    const deleteJson = (await deleteRes.json()) as {
      data: { cancelled: boolean };
    };
    expect(deleteJson.data.cancelled).toBe(true);

    const res = await postPromise;
    const text = await res.text();
    expect(text).toContain("event: stop");
    expect(text).toContain('"reason":"aborted"');

    expect(recordedStatuses).toContain("cancelled");
  });

  it("진행 중인 run 이 없는 세션에 DELETE /:id/active-run 을 호출하면 cancelled:false 를 반환한다", async () => {
    const sessionApp = createSessionRoutes();
    const res = await sessionApp.request("/no-such-session/active-run", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { cancelled: boolean } };
    expect(json.data.cancelled).toBe(false);
  });
});

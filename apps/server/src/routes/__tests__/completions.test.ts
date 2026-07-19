// completions.test.ts — P22-T6-16 RED: routes/completions.ts 가 존재하지 않는다(입력 자동완성 부재).
// 갭 카탈로그 P22-T6-16 / 계약배치 C10 의 서버측 acceptance 를 검증한다:
//   (1) POST /completions → 초안(draft) 을 빠른 task 모델에 보내 이어쓸 조각(completion)만 반환
//   (2) org_settings.autocompleteEnabled=false → 403 FEATURE_DISABLED (provider 호출 자체가 없음)
//   (3) 잘못된 입력(draft 없음/공백/과대) → 400 INVALID_INPUT
//   (4) 요청 취소(AbortSignal)가 provider.chat 으로 전파된다 — C10 승인 조건
// agents.test.ts 와 동일한 주입 auth + fake deps 패턴(실 DB 불필요).
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { createCompletionRoutes } from "../completions.js";
import type { SettingsService } from "../../lib/settings-service.js";
import { DEFAULT_ORG_SETTINGS } from "../../lib/org-settings-schema.js";

interface ProviderCall {
  input: ChatInput;
  signal: AbortSignal;
}

function makeProvider(
  text: string,
  calls: ProviderCall[] = [],
): { provider: LLMProvider; calls: ProviderCall[] } {
  const provider: LLMProvider = {
    name: "fake",
    models: ["fast-task-model"],
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      calls.push({ input, signal });
      yield { type: "text_delta", text };
    },
  };
  return { provider, calls };
}

function makeSettings(autocompleteEnabled: boolean): SettingsService {
  return {
    async resolve() {
      return { ...DEFAULT_ORG_SETTINGS, autocompleteEnabled };
    },
    invalidate() {},
  };
}

function appWith(deps: Parameters<typeof createCompletionRoutes>[0]) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: randomUUID(),
      org: randomUUID(),
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", createCompletionRoutes(deps));
  return app;
}

const JSON_HEADERS = { "content-type": "application/json" };

describe("createCompletionRoutes", () => {
  it("POST / — 초안을 이어쓸 조각을 반환한다(200)", async () => {
    const { provider, calls } = makeProvider(" 어떻게 설정하나요?");
    const app = appWith({
      provider,
      model: "fast-task-model",
      settings: makeSettings(true),
    });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: "사내 VPN 을" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { completion: string } };
    expect(body.data.completion).toBe("어떻게 설정하나요?");
    // 초안이 프롬프트로 전달돼야 한다(빠른 task 모델 1회 호출).
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0]?.input.messages)).toContain("사내 VPN 을");
  });

  it("org_settings.autocompleteEnabled=false — 403 FEATURE_DISABLED, provider 미호출", async () => {
    const { provider, calls } = makeProvider("무시되어야 함");
    const app = appWith({
      provider,
      model: "fast-task-model",
      settings: makeSettings(false),
    });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: "사내 VPN 을" }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FEATURE_DISABLED");
    expect(calls).toHaveLength(0);
  });

  it("draft 가 공백이면 400 INVALID_INPUT", async () => {
    const { provider, calls } = makeProvider("x");
    const app = appWith({
      provider,
      model: "fast-task-model",
      settings: makeSettings(true),
    });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: "   " }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });

  it("요청 AbortSignal 이 provider.chat 으로 전파된다(취소 시 provider 도 취소)", async () => {
    const { provider, calls } = makeProvider(" 이어쓰기");
    const app = appWith({
      provider,
      model: "fast-task-model",
      settings: makeSettings(true),
    });

    const controller = new AbortController();
    const res = await app.request(
      new Request("http://localhost/", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ draft: "초안" }),
        signal: controller.signal,
      }),
    );

    expect(res.status).toBe(200);
    const forwarded = calls[0]?.signal;
    expect(forwarded).toBeDefined();
    expect(forwarded?.aborted).toBe(false);
    controller.abort();
    expect(forwarded?.aborted).toBe(true);
  });

  it("provider 가 실패해도 500 이 아니라 빈 completion 으로 fail-soft 한다(L2)", async () => {
    const provider: LLMProvider = {
      name: "boom",
      models: ["fast-task-model"],
      // eslint-disable-next-line require-yield
      async *chat(): AsyncIterable<ChatEvent> {
        throw new Error("provider down");
      },
    };
    const app = appWith({
      provider,
      model: "fast-task-model",
      settings: makeSettings(true),
    });

    const res = await app.request("/", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ draft: "초안" }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { completion: string } };
    expect(body.data.completion).toBe("");
  });
});

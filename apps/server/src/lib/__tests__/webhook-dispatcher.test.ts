// webhook-dispatcher.test.ts — P22-T1-06: 실 HTTP dispatcher(Slack/Discord 호환) +
//   createWebhookDispatcher(kind) 팩토리 스위치. email-sender/alert-engine 의
//   createEmailSender/createAlertNotifier 패턴과 동일(env kind-switch, 주입형 fetch 로 유닛 테스트).
import { describe, it, expect } from "vitest";
import {
  HttpWebhookDispatcher,
  createWebhookDispatcher,
  createDevStubWebhookDispatcher,
} from "../webhook-dispatcher.js";

type FetchCall = { url: string; init?: RequestInit };

function fakeFetch(): { impl: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(null, { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("webhook-dispatcher.HttpWebhookDispatcher", () => {
  it("dispatch 는 url 로 new_user 페이로드를 담은 POST 를 정확히 1회 발송한다(Slack/Discord 호환)", async () => {
    const { impl, calls } = fakeFetch();
    const dispatcher = new HttpWebhookDispatcher(impl);

    await dispatcher.dispatch("https://hooks.example.com/admin", {
      event: "new_user",
      email: "new@acme.test",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.example.com/admin");
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(String(calls[0].init?.body));
    // 페이로드 포함(new_user 이벤트) + Slack(text)/Discord(content) 호환 필드 존재
    expect(body).toMatchObject({ event: "new_user", email: "new@acme.test" });
    expect(typeof body.text).toBe("string");
    expect(typeof body.content).toBe("string");
  });
});

describe("webhook-dispatcher.createWebhookDispatcher", () => {
  it("kind='slack'(또는 'http') 면 주입한 fake fetch 로 실제 POST 하는 HttpWebhookDispatcher 를 반환한다", async () => {
    const { impl, calls } = fakeFetch();
    const dispatcher = createWebhookDispatcher("slack", impl);
    expect(dispatcher).toBeInstanceOf(HttpWebhookDispatcher);

    await dispatcher.dispatch("https://hooks.example.com/admin", {
      event: "new_user",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://hooks.example.com/admin");

    expect(createWebhookDispatcher("http", impl)).toBeInstanceOf(
      HttpWebhookDispatcher,
    );
    expect(createWebhookDispatcher("discord", impl)).toBeInstanceOf(
      HttpWebhookDispatcher,
    );
  });

  it("kind 미설정/'devstub'/'test' 면 네트워크 없는 record-only dev-stub 을 반환한다", () => {
    const stub = createWebhookDispatcher(undefined);
    expect(stub).not.toBeInstanceOf(HttpWebhookDispatcher);
    // dev-stub 은 calls 배열을 노출
    expect(
      (stub as ReturnType<typeof createDevStubWebhookDispatcher>).calls,
    ).toEqual([]);
    expect(createWebhookDispatcher("devstub")).not.toBeInstanceOf(
      HttpWebhookDispatcher,
    );
    expect(createWebhookDispatcher("test")).not.toBeInstanceOf(
      HttpWebhookDispatcher,
    );
  });

  it("알 수 없는 kind 면 throw 한다(createEmailSender/createAlertNotifier 패리티)", () => {
    expect(() => createWebhookDispatcher("bogus")).toThrow(
      "Unknown WEBHOOK_DISPATCHER_KIND",
    );
  });
});

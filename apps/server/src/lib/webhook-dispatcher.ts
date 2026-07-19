// webhook-dispatcher.ts — 신규가입 관리자 알림 웹훅 포트(web-search-port.ts 와 동일한
//   포트-어댑터 원칙). LOCAL_ONLY 엔 실 Slack/Discord 엔드포인트가 없으므로 dev-stub 은
//   실 네트워크 호출 없이 dispatch 기록만 남긴다(embedding/web-search dev-stub 과 동일 패턴).
//   실 Slack/Discord adapter 는 이 인터페이스 뒤에 두고 배포 시 교체.

export interface WebhookDispatchCall {
  url: string;
  payload: Record<string, unknown>;
  dispatchedAt: Date;
}

export interface WebhookDispatcher {
  dispatch(url: string, payload: Record<string, unknown>): Promise<void>;
}

export function createDevStubWebhookDispatcher(): WebhookDispatcher & {
  readonly calls: WebhookDispatchCall[];
} {
  const calls: WebhookDispatchCall[] = [];
  return {
    calls,
    async dispatch(url, payload) {
      calls.push({ url, payload, dispatchedAt: new Date() });
    },
  };
}

// 실 HTTP dispatcher — Slack({text})/Discord({content}) 호환 body 에 원본 payload 를 함께
//   실어 POST 한다(SlackWebhookAlertNotifier 와 동일한 주입형 fetchImpl 로 유닛 테스트 가능).
export class HttpWebhookDispatcher implements WebhookDispatcher {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async dispatch(url: string, payload: Record<string, unknown>): Promise<void> {
    const summary =
      typeof payload.event === "string" ? payload.event : "webhook";
    await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // text=Slack, content=Discord 호환 요약 + 원본 payload 필드 스프레드.
      body: JSON.stringify({ text: summary, content: summary, ...payload }),
    });
  }
}

// createEmailSender(EMAIL_SENDER_KIND)/createAlertNotifier(ALERT_NOTIFIER_KIND) 와 동일한
//   env kind-switch. 미설정/devstub/test 는 record-only dev-stub(back-compat), http/slack/discord
//   는 실 HTTP dispatcher, 그 외는 throw. 배포 시 WEBHOOK_DISPATCHER_KIND 로 flip.
export function createWebhookDispatcher(
  kind: string | undefined = process.env.WEBHOOK_DISPATCHER_KIND,
  fetchImpl: typeof fetch = fetch,
): WebhookDispatcher {
  switch (kind ?? "devstub") {
    case "devstub":
    case "test":
      return createDevStubWebhookDispatcher();
    case "http":
    case "slack":
    case "discord":
      return new HttpWebhookDispatcher(fetchImpl);
    default:
      throw new Error(`Unknown WEBHOOK_DISPATCHER_KIND: ${kind}`);
  }
}

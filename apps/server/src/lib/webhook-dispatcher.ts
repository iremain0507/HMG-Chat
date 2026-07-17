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

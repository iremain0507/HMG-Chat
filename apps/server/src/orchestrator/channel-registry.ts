// channel-registry.ts — 채널 단위 in-process push 버스 (P22-T6-12, 계약 승인 C8).
// notification-registry.ts(사용자 단위)의 자매 구현 — 키가 userId 가 아니라 channelId 다.
// routes/channels.ts 가 글/반응을 저장한 뒤 publishChannelEvent(channelId, event) 를 호출하면,
// 그 채널의 열린 SSE 구독자(subscribeChannel) 전원에게 전달된다. 다른 채널로는 가지 않는다.
// (배포 시 cross-instance push 는 P22-T2-03 의 Redis pub/sub 어댑터로 교체 대상.)
//
// ChannelEvent 는 **여기 로컬 정의**다 — packages/interfaces 는 FROZEN 계약이라
// 라우트 전용 wire 타입을 밀어 넣지 않는다(경로 소유권 규칙).

/** SSE 로 나가는 메시지 표현. 날짜는 ISO 문자열(routes/notes.ts toDto 규약). */
export interface ChannelMessageDto {
  id: string;
  orgId: string;
  channelId: string;
  userId: string | null;
  role: "user" | "assistant";
  content: string;
  parentId: string | null;
  createdAt: string;
}

export type ChannelEvent =
  | { type: "channel_message"; message: ChannelMessageDto }
  | {
      type: "channel_reaction";
      messageId: string;
      emoji: string;
      userId: string;
      op: "add" | "remove";
    };

// notification-registry.ts NotificationQueue 와 동일한 back-pressure 없는 단일 채널 큐.
class ChannelQueue implements AsyncIterable<ChannelEvent> {
  private buffered: ChannelEvent[] = [];
  private waiters: Array<(result: IteratorResult<ChannelEvent>) => void> = [];
  private closed = false;

  push(event: ChannelEvent): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.buffered.push(event);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  private next(): Promise<IteratorResult<ChannelEvent>> {
    const buffered = this.buffered.shift();
    if (buffered) {
      return Promise.resolve({ value: buffered, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<ChannelEvent> {
    return { next: () => this.next() };
  }
}

export interface ChannelSubscription {
  events: AsyncIterable<ChannelEvent>;
  unsubscribe(): void;
}

// channelId → 그 방의 열린 구독자 집합(탭 여러 개 = 구독자 여러 개).
const subscribers = new Map<string, Set<ChannelQueue>>();

export function publishChannelEvent(
  channelId: string,
  event: ChannelEvent,
): void {
  const set = subscribers.get(channelId);
  if (!set) return;
  for (const queue of set) {
    queue.push(event);
  }
}

export function subscribeChannel(channelId: string): ChannelSubscription {
  const queue = new ChannelQueue();
  let set = subscribers.get(channelId);
  if (!set) {
    set = new Set();
    subscribers.set(channelId, set);
  }
  set.add(queue);
  return {
    events: queue,
    unsubscribe() {
      queue.close();
      const current = subscribers.get(channelId);
      if (!current) return;
      current.delete(queue);
      if (current.size === 0) subscribers.delete(channelId);
    },
  };
}

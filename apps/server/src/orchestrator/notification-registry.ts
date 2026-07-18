// notification-registry.ts — 16-API-CONTRACT.md § GET /notifications (SSE) 단일 출처의
// 서버측 push 버스. run-registry.ts / message-run-registry.ts 와 동일하게 프로세스 내
// in-memory 상태(LOCAL_ONLY) — 사용자 단위로 NotificationEvent 를 fan-out 한다.
// 소스(document 인덱싱 완료 등)가 publishNotification(userId, event) 를 호출하면, 그 사용자의
// 열린 SSE 구독자(subscribeNotifications) 전원에게 전달된다. 다른 사용자에게는 가지 않는다.
// (배포 시 cross-instance push 는 P22-T2-03 의 Redis pub/sub 어댑터로 교체 대상.)
import type { NotificationEvent } from "@wchat/interfaces";

// message-run-registry.ts SubscriberQueue 와 동일한 back-pressure 없는 단일 채널 큐.
class NotificationQueue implements AsyncIterable<NotificationEvent> {
  private buffered: NotificationEvent[] = [];
  private waiters: Array<(result: IteratorResult<NotificationEvent>) => void> =
    [];
  private closed = false;

  push(event: NotificationEvent): void {
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

  private next(): Promise<IteratorResult<NotificationEvent>> {
    const buffered = this.buffered.shift();
    if (buffered) {
      return Promise.resolve({ value: buffered, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<NotificationEvent> {
    return { next: () => this.next() };
  }
}

export interface NotificationSubscription {
  events: AsyncIterable<NotificationEvent>;
  unsubscribe(): void;
}

// userId → 그 사용자의 열린 구독자 집합(탭 여러 개 = 구독자 여러 개).
const subscribers = new Map<string, Set<NotificationQueue>>();

export function publishNotification(
  userId: string,
  event: NotificationEvent,
): void {
  const set = subscribers.get(userId);
  if (!set) return;
  for (const queue of set) {
    queue.push(event);
  }
}

export function subscribeNotifications(
  userId: string,
): NotificationSubscription {
  const queue = new NotificationQueue();
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  set.add(queue);
  return {
    events: queue,
    unsubscribe() {
      queue.close();
      const current = subscribers.get(userId);
      if (!current) return;
      current.delete(queue);
      if (current.size === 0) subscribers.delete(userId);
    },
  };
}

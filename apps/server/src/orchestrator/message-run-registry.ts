// message-run-registry.ts — 16-API-CONTRACT.md § GET /sessions/:id/messages/:messageId/stream
// (resume) 단일 출처. run-registry.ts(abort)와 동일하게 프로세스 내 in-memory 상태(LOCAL_ONLY).
// POST /sessions/:id/messages(routes/messages.ts) 가 진행 중인 메시지의 messageId 로
// startMessageRun/recordMessageRunEvent 를 호출해 누적 content + terminal 여부를 기록하고,
// GET resume 엔드포인트가 subscribeMessageRun 으로 그 상태를 읽어 message_replace 로 캐치업 후
// 이어지는 live event 를 broadcast 없이 단일 구독자로만 relay 한다(동시 구독 시 409).
import type { ChatEvent } from "@wchat/interfaces";

type TerminalReason = "end_turn" | "max_tokens" | "aborted";

class SubscriberQueue implements AsyncIterable<ChatEvent> {
  private buffered: ChatEvent[] = [];
  private waiters: Array<(result: IteratorResult<ChatEvent>) => void> = [];
  private closed = false;

  push(event: ChatEvent): void {
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

  private next(): Promise<IteratorResult<ChatEvent>> {
    const buffered = this.buffered.shift();
    if (buffered) {
      return Promise.resolve({ value: buffered, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator](): AsyncIterator<ChatEvent> {
    return { next: () => this.next() };
  }
}

interface MessageRunState {
  sessionId: string;
  contentSoFar: string;
  terminalReason?: TerminalReason;
  subscriber?: SubscriberQueue;
}

const runs = new Map<string, MessageRunState>();

// POST 핸들러가 message_start 를 볼 때마다 호출 — 새 messageId 를 non-terminal 상태로 등록.
export function startMessageRun(messageId: string, sessionId: string): void {
  runs.set(messageId, { sessionId, contentSoFar: "" });
}

// POST 핸들러가 진행 중인 turn 의 매 ChatEvent 를 (message_start 로 파악한 현재 messageId 기준)
// 여기로도 전달 — text_delta 누적, stop(비 tool_use) 이면 terminal 처리 후 구독자 스트림 종료.
export function recordMessageRunEvent(
  messageId: string,
  event: ChatEvent,
): void {
  const run = runs.get(messageId);
  if (!run) return;
  if (event.type === "text_delta") {
    run.contentSoFar += event.text;
  } else if (event.type === "stop" && event.reason !== "tool_use") {
    run.terminalReason = event.reason;
  }
  run.subscriber?.push(event);
  if (run.terminalReason) {
    run.subscriber?.close();
  }
}

export type ResumeSubscription =
  | { kind: "not_found" }
  | { kind: "gone" }
  | { kind: "conflict" }
  | {
      kind: "ok";
      contentSoFar: string;
      events: AsyncIterable<ChatEvent>;
      unsubscribe: () => void;
    };

// GET resume 엔드포인트 전용 — 404(부재/타 세션 소유)·410(이미 terminal)·409(이미 다른 구독자)
// 순으로 판정 후, 통과하면 현재까지의 contentSoFar 스냅샷 + 이후 live event 를 넘겨줄
// AsyncIterable 을 반환한다(broadcast 미지원 — 동시 구독은 409로 차단).
export function subscribeMessageRun(
  messageId: string,
  sessionId: string,
): ResumeSubscription {
  const run = runs.get(messageId);
  if (!run || run.sessionId !== sessionId) {
    return { kind: "not_found" };
  }
  if (run.terminalReason) {
    return { kind: "gone" };
  }
  if (run.subscriber) {
    return { kind: "conflict" };
  }
  const queue = new SubscriberQueue();
  run.subscriber = queue;
  return {
    kind: "ok",
    contentSoFar: run.contentSoFar,
    events: queue,
    unsubscribe: () => {
      if (run.subscriber === queue) {
        delete run.subscriber;
      }
    },
  };
}

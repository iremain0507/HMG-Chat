// message-run-registry.ts — 16-API-CONTRACT.md § GET /sessions/:id/messages/:messageId/stream
// (resume) 단일 출처.
// POST /sessions/:id/messages(routes/messages.ts) 가 진행 중인 메시지의 messageId 로
// startMessageRun/recordMessageRunEvent 를 호출해 누적 content + terminal 여부를 기록하고,
// GET resume 엔드포인트가 subscribeMessageRun 으로 그 상태를 읽어 message_replace 로 캐치업 후
// 이어지는 live event 를 broadcast 없이 단일 구독자로만 relay 한다(동시 구독 시 409).
//
// P22-T2-03: SubscriberQueue 는 직렬화 불가능한 in-process 객체이므로, 다중 인스턴스에서는
// (a) RuntimeBus key `wchat:msgrun:{messageId}` 에 {sessionId, contentSoFar, terminalReason, claimed}
//     스냅샷을 공유해 캐치업·404/410/409 판정을 어느 인스턴스에서든 가능하게 하고
// (b) channel `wchat:msgrun:ev:{messageId}` 로 live ChatEvent 를 팬아웃해, run 을 소유하지 않은
//     인스턴스에 붙은 SSE 구독자에게 이어지는 event 를 relay 한다.
// 소유 인스턴스의 로컬 구독자는 기존 run.subscriber 경로로만 받는다(채널은 원격 전용 → 중복 배달 없음).
import type { ChatEvent } from "@wchat/interfaces";
import { getRuntimeBus, type RuntimeBus } from "./runtime-bus.js";

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

export interface MessageRunRegistry {
  startMessageRun(messageId: string, sessionId: string): Promise<void>;
  recordMessageRunEvent(messageId: string, event: ChatEvent): Promise<void>;
  subscribeMessageRun(
    messageId: string,
    sessionId: string,
  ): Promise<ResumeSubscription>;
  close(): Promise<void>;
}

// 공유 스냅샷 — 어느 인스턴스에서든 캐치업/판정이 가능하도록 직렬화 가능한 필드만 담는다.
interface SharedRunSnapshot {
  sessionId: string;
  contentSoFar: string;
  terminalReason?: TerminalReason;
  claimed?: boolean;
}

// run 이 죽은 인스턴스에 묶여 좀비 key 로 남지 않도록 TTL 을 건다.
const MESSAGE_RUN_TTL_SECONDS = 3600;

function sharedKey(messageId: string): string {
  return `wchat:msgrun:${messageId}`;
}

function eventChannel(messageId: string): string {
  return `wchat:msgrun:ev:${messageId}`;
}

function isTerminalStop(event: ChatEvent): event is ChatEvent & {
  type: "stop";
  reason: TerminalReason;
} {
  return event.type === "stop" && event.reason !== "tool_use";
}

export function createMessageRunRegistry(bus: RuntimeBus): MessageRunRegistry {
  const runs = new Map<string, MessageRunState>();
  // 원격 구독(다른 인스턴스가 소유한 run) 의 채널 해제 함수들 — close() 에서 일괄 정리.
  const remoteUnsubscribes = new Set<() => Promise<void>>();

  async function readShared(
    messageId: string,
  ): Promise<SharedRunSnapshot | null> {
    const raw = await bus.get(sharedKey(messageId));
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SharedRunSnapshot;
    } catch {
      return null;
    }
  }

  async function writeShared(
    messageId: string,
    snapshot: SharedRunSnapshot,
  ): Promise<void> {
    await bus.set(
      sharedKey(messageId),
      JSON.stringify(snapshot),
      MESSAGE_RUN_TTL_SECONDS,
    );
  }

  async function patchShared(
    messageId: string,
    patch: Partial<SharedRunSnapshot>,
  ): Promise<void> {
    const current = await readShared(messageId);
    if (!current) return;
    await writeShared(messageId, { ...current, ...patch });
  }

  return {
    async startMessageRun(messageId, sessionId) {
      runs.set(messageId, { sessionId, contentSoFar: "" });
      await writeShared(messageId, { sessionId, contentSoFar: "" });
    },

    async recordMessageRunEvent(messageId, event) {
      const run = runs.get(messageId);
      if (!run) return;
      if (event.type === "text_delta") {
        run.contentSoFar += event.text;
      } else if (isTerminalStop(event)) {
        run.terminalReason = event.reason;
      }
      run.subscriber?.push(event);
      if (run.terminalReason) {
        run.subscriber?.close();
      }
      // 공유 스냅샷 미러링 — 다른 인스턴스가 캐치업/410 판정을 할 수 있게 한다.
      // claimed 는 구독자 소유 플래그이므로 여기서 덮어쓰지 않는다.
      await patchShared(messageId, {
        contentSoFar: run.contentSoFar,
        ...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
      });
      // 원격 구독자에게 live relay.
      await bus.publish(eventChannel(messageId), JSON.stringify(event));
    },

    async subscribeMessageRun(messageId, sessionId) {
      const run = runs.get(messageId);
      if (run) {
        // --- 로컬(소유) 경로 — 기존 semantics 그대로.
        if (run.sessionId !== sessionId) {
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

      // --- 원격 경로 — run 을 다른 인스턴스가 소유 중일 수 있다.
      const snapshot = await readShared(messageId);
      if (!snapshot || snapshot.sessionId !== sessionId) {
        return { kind: "not_found" };
      }
      if (snapshot.terminalReason) {
        return { kind: "gone" };
      }
      if (snapshot.claimed) {
        return { kind: "conflict" };
      }

      // claim — 다른 인스턴스의 동시 구독을 409 로 막는다.
      await writeShared(messageId, { ...snapshot, claimed: true });

      const queue = new SubscriberQueue();
      const off = await bus.subscribe(eventChannel(messageId), (payload) => {
        let event: ChatEvent;
        try {
          event = JSON.parse(payload) as ChatEvent;
        } catch {
          return;
        }
        queue.push(event);
        if (isTerminalStop(event)) {
          queue.close();
        }
      });
      remoteUnsubscribes.add(off);

      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        remoteUnsubscribes.delete(off);
        void off().then(() => patchShared(messageId, { claimed: false }));
      };

      return {
        kind: "ok",
        contentSoFar: snapshot.contentSoFar,
        events: queue,
        unsubscribe: release,
      };
    },

    async close() {
      for (const off of [...remoteUnsubscribes]) {
        await off();
      }
      remoteUnsubscribes.clear();
      runs.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// 프로세스 기본 인스턴스 — 현재 활성 RuntimeBus 를 따라간다(app.ts 가 부팅 시 선택).
// ---------------------------------------------------------------------------

let cachedBus: RuntimeBus | undefined;
let cachedRegistry: MessageRunRegistry | undefined;

function defaultRegistry(): MessageRunRegistry {
  const bus = getRuntimeBus();
  if (!cachedRegistry || cachedBus !== bus) {
    cachedBus = bus;
    cachedRegistry = createMessageRunRegistry(bus);
  }
  return cachedRegistry;
}

export function startMessageRun(
  messageId: string,
  sessionId: string,
): Promise<void> {
  return defaultRegistry().startMessageRun(messageId, sessionId);
}

export function recordMessageRunEvent(
  messageId: string,
  event: ChatEvent,
): Promise<void> {
  return defaultRegistry().recordMessageRunEvent(messageId, event);
}

export function subscribeMessageRun(
  messageId: string,
  sessionId: string,
): Promise<ResumeSubscription> {
  return defaultRegistry().subscribeMessageRun(messageId, sessionId);
}

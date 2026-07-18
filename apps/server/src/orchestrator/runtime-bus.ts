// runtime-bus.ts — P22-T2-03: 배포시 선택 가능한 런타임 상태 백엔드 seam.
//
// run-registry(abort) / message-run-registry(resume) / hitl-manager(HITL) 는
// AbortController · SubscriberQueue · settle() promise 처럼 **직렬화 불가능한 in-process 객체**를
// 들고 있다. 따라서 진짜 cross-instance 동작은 (a) 공유 key store 로 "누가 그 run 을 들고 있는지"를
// 알리고, (b) pub/sub 로 abort 신호·live event·HITL 결정을 소유 인스턴스로 팬아웃하는 두 축으로 만든다.
// 이 파일은 그 두 축만 추상화한다(14-INTERFACES.md § 9 의 `hitl:{sessionId}:{toolCallId}` 키 구조 준수).
//
// LOCAL_ONLY 기본값 = createInMemoryRuntimeBus() → 기존 단일 프로세스 동작과 100% 동일.
// 배포(다중 ECS task) = createRedisRuntimeBus(...) → 같은 Redis 를 공유하는 인스턴스 간에 동작.
//
// packages/interfaces 를 건드리지 않기 위해 서버 로컬 인터페이스로 정의한다(태스크 team=T2 유지).

export interface RuntimeBus {
  /** 공유 key 에 값을 쓴다. ttlSeconds 가 있으면 만료도 설정. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** prefix 로 시작하는 모든 key 를 반환(listPendingHitl 용). */
  keysWithPrefix(prefix: string): Promise<string[]>;
  /** channel 로 payload 를 팬아웃. 자기 자신이 구독 중이면 자기에게도 전달된다. */
  publish(channel: string, payload: string): Promise<void>;
  /** channel 구독. 반환값을 호출하면 구독 해제. */
  subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// in-memory (LOCAL_ONLY 기본) — 프로세스 내부에서만 유효.
// ---------------------------------------------------------------------------

/**
 * 여러 RuntimeBus 핸들이 공유하는 backing store. 한 개만 만들어 한 프로세스가 쓰면
 * 기존 LOCAL_ONLY 동작이고, 테스트에서 하나를 두 개의 bus 핸들에 공유시키면
 * "같은 Redis 를 보는 두 인스턴스"를 정확히 시뮬레이션한다.
 */
export interface InMemoryRuntimeStore {
  kv: Map<string, { value: string; expiresAt?: number }>;
  channels: Map<string, Set<(payload: string) => void>>;
}

export function createInMemoryRuntimeStore(): InMemoryRuntimeStore {
  return { kv: new Map(), channels: new Map() };
}

export function createInMemoryRuntimeBus(
  store: InMemoryRuntimeStore = createInMemoryRuntimeStore(),
): RuntimeBus {
  // 이 핸들이 등록한 핸들러만 close() 로 정리한다(다른 인스턴스 구독은 건드리지 않음).
  const own = new Set<{
    channel: string;
    handler: (payload: string) => void;
  }>();

  function readLive(key: string): string | null {
    const entry = store.kv.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      store.kv.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    async set(key, value, ttlSeconds) {
      store.kv.set(key, {
        value,
        ...(ttlSeconds !== undefined
          ? { expiresAt: Date.now() + ttlSeconds * 1000 }
          : {}),
      });
    },
    async get(key) {
      return readLive(key);
    },
    async del(key) {
      store.kv.delete(key);
    },
    async keysWithPrefix(prefix) {
      return [...store.kv.keys()].filter(
        (k) => k.startsWith(prefix) && readLive(k) !== null,
      );
    },
    async publish(channel, payload) {
      const subs = store.channels.get(channel);
      if (!subs) return;
      // 핸들러가 구독을 해제하는 경우가 있으므로 스냅샷 후 순회.
      for (const handler of [...subs]) handler(payload);
    },
    async subscribe(channel, handler) {
      let subs = store.channels.get(channel);
      if (!subs) {
        subs = new Set();
        store.channels.set(channel, subs);
      }
      subs.add(handler);
      const entry = { channel, handler };
      own.add(entry);
      return async () => {
        own.delete(entry);
        store.channels.get(channel)?.delete(handler);
      };
    },
    async close() {
      for (const { channel, handler } of own) {
        store.channels.get(channel)?.delete(handler);
      }
      own.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Redis-backed (배포 선택) — ioredis(계약배치 C18 승인 dep).
// ---------------------------------------------------------------------------

/**
 * ioredis 의 필요한 부분만 구조적으로 요구한다. 이렇게 하면 (a) 이 모듈이 ioredis 를
 * 정적 import 하지 않아 LOCAL_ONLY 부팅 비용이 0 이고, (b) 테스트에서 fake client 로
 * 명령 매핑(SET/GET/DEL/SCAN/PUBLISH/SUBSCRIBE)을 검증할 수 있다.
 */
export interface RedisLikeClient {
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<unknown>;
  scan(
    cursor: string,
    matchToken: "MATCH",
    pattern: string,
    countToken: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  publish(channel: string, payload: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(
    event: "message",
    listener: (channel: string, payload: string) => void,
  ): void;
  off?(
    event: "message",
    listener: (channel: string, payload: string) => void,
  ): void;
  quit(): Promise<unknown>;
}

/**
 * Redis 는 한 커넥션이 SUBSCRIBE 모드에 들어가면 일반 명령을 받지 못하므로
 * 반드시 커넥션 2개(명령용 `client`, 구독 전용 `subscriber`)를 넘긴다.
 */
export function createRedisRuntimeBus(
  client: RedisLikeClient,
  subscriber: RedisLikeClient,
): RuntimeBus {
  const handlers = new Map<string, Set<(payload: string) => void>>();

  const onMessage = (channel: string, payload: string): void => {
    for (const handler of [...(handlers.get(channel) ?? [])]) handler(payload);
  };
  subscriber.on("message", onMessage);

  return {
    async set(key, value, ttlSeconds) {
      if (ttlSeconds !== undefined) {
        await client.set(key, value, "EX", Math.max(1, Math.ceil(ttlSeconds)));
      } else {
        await client.set(key, value);
      }
    },
    async get(key) {
      return client.get(key);
    },
    async del(key) {
      await client.del(key);
    },
    async keysWithPrefix(prefix) {
      // KEYS 는 프로덕션에서 블로킹이므로 SCAN 커서 순회를 쓴다.
      const found: string[] = [];
      let cursor = "0";
      do {
        const [next, batch] = await client.scan(
          cursor,
          "MATCH",
          `${prefix}*`,
          "COUNT",
          200,
        );
        found.push(...batch);
        cursor = next;
      } while (cursor !== "0");
      return [...new Set(found)];
    },
    async publish(channel, payload) {
      await client.publish(channel, payload);
    },
    async subscribe(channel, handler) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
        await subscriber.subscribe(channel);
      }
      set.add(handler);
      return async () => {
        const current = handlers.get(channel);
        if (!current) return;
        current.delete(handler);
        if (current.size === 0) {
          handlers.delete(channel);
          await subscriber.unsubscribe(channel);
        }
      };
    },
    async close() {
      subscriber.off?.("message", onMessage);
      handlers.clear();
      await Promise.all([subscriber.quit(), client.quit()]);
    },
  };
}

// ---------------------------------------------------------------------------
// 프로세스 전역 선택 seam — app.ts 부팅 시 setRuntimeBus() 로 교체.
// ---------------------------------------------------------------------------

let activeBus: RuntimeBus = createInMemoryRuntimeBus();

export function getRuntimeBus(): RuntimeBus {
  return activeBus;
}

/** 부팅 시 1회. 반환값을 호출하면 이전 bus 로 되돌린다(테스트 정리용). */
export function setRuntimeBus(bus: RuntimeBus): () => void {
  const previous = activeBus;
  activeBus = bus;
  return () => {
    activeBus = previous;
  };
}

export interface RuntimeBusHandle {
  backend: "memory" | "redis";
  bus: RuntimeBus;
  stop(): Promise<void>;
}

/**
 * 부팅 시 env 로 백엔드를 고른다(index.ts 가 lifecycle 소유 — alerting/retention 스케줄러와 동일 패턴).
 * ioredis 는 redis 를 고른 경우에만 동적 import 하므로 LOCAL_ONLY 부팅에는 아무 비용이 없다.
 */
export async function activateRuntimeBusFromEnv(env: {
  RUNTIME_STATE_BACKEND: "memory" | "redis";
  REDIS_URL: string;
}): Promise<RuntimeBusHandle> {
  if (env.RUNTIME_STATE_BACKEND === "memory") {
    const bus = createInMemoryRuntimeBus();
    const restore = setRuntimeBus(bus);
    return {
      backend: "memory",
      bus,
      stop: async () => {
        restore();
        await bus.close();
      },
    };
  }

  const { default: Redis } = await import("ioredis");
  // Redis 는 SUBSCRIBE 모드 커넥션에서 일반 명령을 받지 못하므로 커넥션 2개가 필수.
  const client = new Redis(env.REDIS_URL);
  const subscriber = new Redis(env.REDIS_URL);
  const bus = createRedisRuntimeBus(
    client as unknown as RedisLikeClient,
    subscriber as unknown as RedisLikeClient,
  );
  const restore = setRuntimeBus(bus);
  return {
    backend: "redis",
    bus,
    stop: async () => {
      restore();
      await bus.close();
    },
  };
}

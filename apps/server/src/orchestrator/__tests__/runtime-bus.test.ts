// runtime-bus.test.ts — P22-T2-03: 백엔드 seam 자체의 계약.
// in-memory(LOCAL_ONLY 기본)와 Redis 어댑터가 같은 RuntimeBus 계약을 만족하는지,
// Redis 쪽은 fake client 로 실제 발행되는 명령(SET/EX/GET/DEL/SCAN/PUBLISH/SUBSCRIBE)까지 확인한다.
import { describe, it, expect, vi } from "vitest";
import {
  createInMemoryRuntimeBus,
  createInMemoryRuntimeStore,
  createRedisRuntimeBus,
  getRuntimeBus,
  setRuntimeBus,
  type RedisLikeClient,
} from "../runtime-bus.js";

describe("createInMemoryRuntimeBus", () => {
  it("set/get/del 과 prefix 조회가 동작한다", async () => {
    const bus = createInMemoryRuntimeBus();
    await bus.set("wchat:hitl:s1:c1", "a");
    await bus.set("wchat:hitl:s1:c2", "b");
    await bus.set("wchat:hitl:s2:c1", "c");

    expect(await bus.get("wchat:hitl:s1:c1")).toBe("a");
    expect(await bus.get("nope")).toBeNull();
    expect((await bus.keysWithPrefix("wchat:hitl:s1:")).sort()).toEqual([
      "wchat:hitl:s1:c1",
      "wchat:hitl:s1:c2",
    ]);

    await bus.del("wchat:hitl:s1:c1");
    expect(await bus.get("wchat:hitl:s1:c1")).toBeNull();
  });

  it("TTL 이 지난 key 는 만료돼 조회·prefix 목록에서 사라진다", async () => {
    vi.useFakeTimers();
    try {
      const bus = createInMemoryRuntimeBus();
      await bus.set("k", "v", 10);
      expect(await bus.get("k")).toBe("v");

      vi.advanceTimersByTime(11_000);
      expect(await bus.get("k")).toBeNull();
      expect(await bus.keysWithPrefix("k")).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("store 를 공유하는 두 bus 핸들 사이에 kv 와 pub/sub 이 모두 전달된다(=두 인스턴스)", async () => {
    const store = createInMemoryRuntimeStore();
    const a = createInMemoryRuntimeBus(store);
    const b = createInMemoryRuntimeBus(store);

    await a.set("shared", "from-a");
    expect(await b.get("shared")).toBe("from-a");

    const received: string[] = [];
    await a.subscribe("chan", (p) => received.push(p));
    await b.publish("chan", "hello");
    expect(received).toEqual(["hello"]);
  });

  it("구독 해제 후에는 더 이상 payload 를 받지 않는다", async () => {
    const store = createInMemoryRuntimeStore();
    const a = createInMemoryRuntimeBus(store);
    const b = createInMemoryRuntimeBus(store);

    const received: string[] = [];
    const off = await a.subscribe("chan", (p) => received.push(p));
    await b.publish("chan", "1");
    await off();
    await b.publish("chan", "2");

    expect(received).toEqual(["1"]);
  });

  it("store 를 공유하지 않는 bus 끼리는 서로 보이지 않는다(격리)", async () => {
    const a = createInMemoryRuntimeBus();
    const b = createInMemoryRuntimeBus();
    await a.set("k", "v");
    expect(await b.get("k")).toBeNull();
  });
});

// ioredis 를 실제로 띄우지 않고, 어댑터가 올바른 명령으로 번역하는지만 검증한다.
function fakeRedis() {
  const kv = new Map<string, string>();
  const listeners: Array<(channel: string, payload: string) => void> = [];
  const calls: string[] = [];
  const subscribed = new Set<string>();

  const client: RedisLikeClient = {
    async set(key, value, ...args) {
      calls.push(
        `SET ${key} ${value}${args.length ? ` ${args.join(" ")}` : ""}`,
      );
      kv.set(key, value);
      return "OK";
    },
    async get(key) {
      calls.push(`GET ${key}`);
      return kv.get(key) ?? null;
    },
    async del(key) {
      calls.push(`DEL ${key}`);
      kv.delete(key);
      return 1;
    },
    async scan(cursor, _m, pattern, _c, _count) {
      calls.push(`SCAN ${cursor} MATCH ${pattern}`);
      const prefix = pattern.replace(/\*$/, "");
      const all = [...kv.keys()].filter((k) => k.startsWith(prefix));
      // 커서 순회를 강제하기 위해 일부러 2회에 나눠 응답한다.
      if (cursor === "0") return ["1", all.slice(0, 1)];
      return ["0", all.slice(1)];
    },
    async publish(channel, payload) {
      calls.push(`PUBLISH ${channel}`);
      for (const l of listeners) l(channel, payload);
      return 1;
    },
    async subscribe(channel) {
      calls.push(`SUBSCRIBE ${channel}`);
      subscribed.add(channel);
      return 1;
    },
    async unsubscribe(channel) {
      calls.push(`UNSUBSCRIBE ${channel}`);
      subscribed.delete(channel);
      return 1;
    },
    on(_event, listener) {
      listeners.push(listener);
    },
    async quit() {
      calls.push("QUIT");
      return "OK";
    },
  };
  return { client, calls, subscribed };
}

describe("createRedisRuntimeBus", () => {
  it("TTL 있는 set 은 EX 인자를 붙여 발행한다", async () => {
    const { client, calls } = fakeRedis();
    const bus = createRedisRuntimeBus(client, client);

    await bus.set("k", "v", 30);
    await bus.set("k2", "v2");

    expect(calls).toContain("SET k v EX 30");
    expect(calls).toContain("SET k2 v2");
  });

  it("keysWithPrefix 는 KEYS 대신 SCAN 커서를 끝까지 순회한다", async () => {
    const { client, calls } = fakeRedis();
    const bus = createRedisRuntimeBus(client, client);
    await bus.set("wchat:hitl:s1:a", "1");
    await bus.set("wchat:hitl:s1:b", "2");

    const keys = await bus.keysWithPrefix("wchat:hitl:s1:");

    expect(keys.sort()).toEqual(["wchat:hitl:s1:a", "wchat:hitl:s1:b"]);
    expect(calls.filter((c) => c.startsWith("SCAN"))).toHaveLength(2);
    expect(calls.some((c) => c.startsWith("KEYS"))).toBe(false);
  });

  it("채널당 SUBSCRIBE 는 1회, 마지막 핸들러가 빠질 때만 UNSUBSCRIBE 한다", async () => {
    const { client, calls } = fakeRedis();
    const bus = createRedisRuntimeBus(client, client);

    const seen: string[] = [];
    const off1 = await bus.subscribe("chan", (p) => seen.push(`1:${p}`));
    const off2 = await bus.subscribe("chan", (p) => seen.push(`2:${p}`));
    expect(calls.filter((c) => c === "SUBSCRIBE chan")).toHaveLength(1);

    await bus.publish("chan", "x");
    expect(seen).toEqual(["1:x", "2:x"]);

    await off1();
    expect(calls).not.toContain("UNSUBSCRIBE chan");
    await off2();
    expect(calls).toContain("UNSUBSCRIBE chan");
  });

  it("close 는 양쪽 커넥션을 quit 한다", async () => {
    const cmd = fakeRedis();
    const sub = fakeRedis();
    const bus = createRedisRuntimeBus(cmd.client, sub.client);

    await bus.close();

    expect(cmd.calls).toContain("QUIT");
    expect(sub.calls).toContain("QUIT");
  });
});

describe("프로세스 전역 bus 선택", () => {
  it("setRuntimeBus 로 교체하고 반환된 restore 로 되돌린다", async () => {
    const original = getRuntimeBus();
    const replacement = createInMemoryRuntimeBus();

    const restore = setRuntimeBus(replacement);
    expect(getRuntimeBus()).toBe(replacement);

    restore();
    expect(getRuntimeBus()).toBe(original);
  });
});

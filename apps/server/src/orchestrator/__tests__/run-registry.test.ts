// run-registry.test.ts — P22-T2-03: abort 상태의 in-memory(LOCAL_ONLY) 동작 + 다중 인스턴스 동작.
import { describe, it, expect } from "vitest";
import {
  createRunRegistry,
  registerRun,
  unregisterRun,
  abortRun,
} from "../run-registry.js";
import {
  createInMemoryRuntimeBus,
  createInMemoryRuntimeStore,
} from "../runtime-bus.js";

// 같은 store 를 공유하는 두 bus 핸들 = "같은 Redis 를 보는 두 앱 인스턴스".
function twoInstances() {
  const store = createInMemoryRuntimeStore();
  return {
    a: createRunRegistry(createInMemoryRuntimeBus(store)),
    b: createRunRegistry(createInMemoryRuntimeBus(store)),
  };
}

describe("run-registry — 단일 인스턴스(LOCAL_ONLY) 동작", () => {
  it("등록된 run 을 abort 하면 true 와 함께 controller.abort() 가 호출된다", async () => {
    const registry = createRunRegistry(createInMemoryRuntimeBus());
    const handle = await registry.registerRun("session-1", "job-1");

    expect(handle.controller.signal.aborted).toBe(false);
    await expect(registry.abortRun("session-1")).resolves.toBe(true);
    expect(handle.controller.signal.aborted).toBe(true);
  });

  it("등록되지 않은 세션의 abort 는 false", async () => {
    const registry = createRunRegistry(createInMemoryRuntimeBus());
    await expect(registry.abortRun("nope")).resolves.toBe(false);
  });

  it("같은 세션에 새 run 을 registerRun 하면 이전 run 이 abort 된다(새 턴이 이전 턴 대체)", async () => {
    // 클라 연결 끊김에는 더 이상 messages 라우트가 abort 하지 않으므로(실행중 resume), 겹친
    // 새 턴(편집/재생성) 시작이 이전 턴을 정리하는 자동 경로가 된다.
    const registry = createRunRegistry(createInMemoryRuntimeBus());
    const first = await registry.registerRun("session-sup", "job-1");
    expect(first.controller.signal.aborted).toBe(false);

    const second = await registry.registerRun("session-sup", "job-2");
    expect(first.controller.signal.aborted).toBe(true);
    expect(second.controller.signal.aborted).toBe(false);
    // 새 run 이 활성 — abortRun 은 최신(job-2)을 취소한다.
    await expect(registry.abortRun("session-sup")).resolves.toBe(true);
    expect(second.controller.signal.aborted).toBe(true);
  });

  it("unregisterRun 후에는 abort 가 false — jobId 가 다르면 해제하지 않는다", async () => {
    const registry = createRunRegistry(createInMemoryRuntimeBus());
    await registry.registerRun("session-1", "job-1");

    // 다른 jobId 로의 해제는 무시돼야 한다(뒤늦게 끝난 이전 leg 이 현재 run 을 지우는 것 방지).
    await registry.unregisterRun("session-1", "job-OTHER");
    await expect(registry.abortRun("session-1")).resolves.toBe(true);

    await registry.unregisterRun("session-1", "job-1");
    await expect(registry.abortRun("session-1")).resolves.toBe(false);
  });

  it("모듈 기본 인스턴스도 동일하게 동작한다(기존 라우트 경로)", async () => {
    const handle = await registerRun("session-default", "job-d");
    await expect(abortRun("session-default")).resolves.toBe(true);
    expect(handle.controller.signal.aborted).toBe(true);
    await unregisterRun("session-default", "job-d");
    await expect(abortRun("session-default")).resolves.toBe(false);
  });
});

describe("run-registry — cross-instance abort (P22-T2-03)", () => {
  it("A 에서 시작한 run 을 B 가 abort 하면 A 의 controller 가 실제로 abort 되고 B 는 true 를 반환한다", async () => {
    const { a, b } = twoInstances();
    const handle = await a.registerRun("session-x", "job-x");

    // 이것이 이 태스크의 핵심 acceptance — 오늘(프로세스 로컬)은 B 가 false 를 반환한다.
    await expect(b.abortRun("session-x")).resolves.toBe(true);
    expect(handle.controller.signal.aborted).toBe(true);
  });

  it("A 가 unregister 한 뒤에는 B 도 false 를 반환한다(공유 key 정리)", async () => {
    const { a, b } = twoInstances();
    await a.registerRun("session-y", "job-y");
    await a.unregisterRun("session-y", "job-y");

    await expect(b.abortRun("session-y")).resolves.toBe(false);
  });

  it("어느 인스턴스도 들고 있지 않은 세션은 false", async () => {
    const { b } = twoInstances();
    await expect(b.abortRun("session-unknown")).resolves.toBe(false);
  });

  it("abort 팬아웃은 해당 세션의 run 만 취소한다(다른 세션 무영향)", async () => {
    const { a, b } = twoInstances();
    const target = await a.registerRun("session-target", "job-1");
    const bystander = await a.registerRun("session-bystander", "job-2");

    await expect(b.abortRun("session-target")).resolves.toBe(true);
    expect(target.controller.signal.aborted).toBe(true);
    expect(bystander.controller.signal.aborted).toBe(false);
  });
});

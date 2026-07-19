// run-registry.ts — abort flow (L06, 08-SPRINT-PLAN.md § Phase 2).
// sessionId → 진행 중인 run 의 AbortController 매핑.
// DELETE /sessions/:id/active-run (routes/sessions.ts) 이 여기서 controller 를 찾아 abort() 한다.
//
// P22-T2-03: AbortController 는 직렬화 불가능한 in-process 객체이므로, 다중 인스턴스에서는
// (a) RuntimeBus key 로 "어떤 세션에 활성 run 이 있는지"를 공유하고
// (b) pub/sub 로 abort 신호를 실제 controller 를 들고 있는 인스턴스에 팬아웃한다.
// LOCAL_ONLY(in-memory bus) 에서는 (a)(b) 가 모두 프로세스 내부라 기존 동작과 동일하다.
import { getRuntimeBus, type RuntimeBus } from "./runtime-bus.js";

export interface ActiveRunHandle {
  sessionId: string;
  jobId: string;
  controller: AbortController;
}

const ABORT_CHANNEL = "wchat:run:abort";
// 활성 run key 의 TTL — 인스턴스가 죽어 unregister 를 못해도 좀비 key 가 남지 않게 한다.
const ACTIVE_RUN_TTL_SECONDS = 3600;

function activeRunKey(sessionId: string): string {
  return `wchat:run:${sessionId}`;
}

export interface RunRegistry {
  registerRun(sessionId: string, jobId: string): Promise<ActiveRunHandle>;
  unregisterRun(sessionId: string, jobId: string): Promise<void>;
  abortRun(sessionId: string): Promise<boolean>;
  close(): Promise<void>;
}

export function createRunRegistry(bus: RuntimeBus): RunRegistry {
  const registry = new Map<string, ActiveRunHandle>();
  let unsubscribe: (() => Promise<void>) | undefined;
  let subscribing: Promise<void> | undefined;

  // 다른 인스턴스가 publish 한 abort 를 이 인스턴스의 로컬 controller 에 적용.
  function ensureSubscribed(): Promise<void> {
    if (subscribing) return subscribing;
    subscribing = bus
      .subscribe(ABORT_CHANNEL, (sessionId) => {
        registry.get(sessionId)?.controller.abort();
      })
      .then((off) => {
        unsubscribe = off;
      });
    return subscribing;
  }

  return {
    async registerRun(sessionId, jobId) {
      await ensureSubscribed();
      // 같은 세션에 진행 중 run 이 있으면 abort 한다 — send/편집/재생성으로 새 턴이 시작되면
      // 이전 턴을 대체한다. (클라 연결 끊김에는 messages 라우트가 더는 abort 하지 않으므로, 새 턴
      // 시작이 이전 턴을 정리하는 유일한 자동 경로 — 그 외엔 명시적 Stop.) 로컬에 없으면 다른
      // 인스턴스 소유일 수 있어 공유 채널로 abort 를 팬아웃한다.
      const existing = registry.get(sessionId);
      if (existing) {
        existing.controller.abort();
      } else if ((await bus.get(activeRunKey(sessionId))) !== null) {
        await bus.publish(ABORT_CHANNEL, sessionId);
      }
      const handle: ActiveRunHandle = {
        sessionId,
        jobId,
        controller: new AbortController(),
      };
      registry.set(sessionId, handle);
      await bus.set(activeRunKey(sessionId), jobId, ACTIVE_RUN_TTL_SECONDS);
      return handle;
    },

    async unregisterRun(sessionId, jobId) {
      const current = registry.get(sessionId);
      if (current && current.jobId === jobId) {
        registry.delete(sessionId);
      }
      // 소유 인스턴스만 공유 key 를 지운다(다른 인스턴스의 run 을 지우지 않도록 jobId 대조).
      if (!current || current.jobId === jobId) {
        const owner = await bus.get(activeRunKey(sessionId));
        if (owner === null || owner === jobId) {
          await bus.del(activeRunKey(sessionId));
        }
      }
    },

    // Stop 클릭 → true(진행 중이던 run 을 찾아 abort() 호출), 없으면 false.
    async abortRun(sessionId) {
      const handle = registry.get(sessionId);
      if (handle) {
        handle.controller.abort();
        return true;
      }
      // 로컬에 없으면 다른 인스턴스가 들고 있을 수 있다 — 공유 key 로 존재를 확인하고 팬아웃.
      const owner = await bus.get(activeRunKey(sessionId));
      if (owner === null) return false;
      await bus.publish(ABORT_CHANNEL, sessionId);
      return true;
    },

    async close() {
      await unsubscribe?.();
      unsubscribe = undefined;
      subscribing = undefined;
      registry.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// 프로세스 기본 인스턴스 — 현재 활성 RuntimeBus 를 따라간다(app.ts 가 부팅 시 선택).
// ---------------------------------------------------------------------------

let cachedBus: RuntimeBus | undefined;
let cachedRegistry: RunRegistry | undefined;

function defaultRegistry(): RunRegistry {
  const bus = getRuntimeBus();
  if (!cachedRegistry || cachedBus !== bus) {
    cachedBus = bus;
    cachedRegistry = createRunRegistry(bus);
  }
  return cachedRegistry;
}

export function registerRun(
  sessionId: string,
  jobId: string,
): Promise<ActiveRunHandle> {
  return defaultRegistry().registerRun(sessionId, jobId);
}

export function unregisterRun(sessionId: string, jobId: string): Promise<void> {
  return defaultRegistry().unregisterRun(sessionId, jobId);
}

export function abortRun(sessionId: string): Promise<boolean> {
  return defaultRegistry().abortRun(sessionId);
}

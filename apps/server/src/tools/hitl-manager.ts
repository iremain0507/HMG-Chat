// hitl-manager.ts — 14-INTERFACES.md § 9 HitlBridge 단일 구현 지정 경로
// ("apps/server/src/tools/hitl-manager.ts 가 구현").
// P22-T2-03: RuntimeBus seam 위에서 동작하도록 factory 화 (run-registry.ts 와 동일 패턴).
import type { HitlBridge, HitlDecision } from "@wchat/interfaces";
import { getRuntimeBus, type RuntimeBus } from "../orchestrator/runtime-bus.js";

interface PendingEntry {
  sessionId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  requestedAt: string;
  expiresAt: string;
  settle: (decision: HitlDecision) => void;
}

function key(sessionId: string, toolCallId: string): string {
  return `${sessionId}:${toolCallId}`;
}

// 14-INTERFACES.md § 9 의 `hitl:{sessionId}:{toolCallId}` 구조를 유지하되 prefix 네임스페이스를 붙인다.
function pendingKey(sessionId: string, toolCallId: string): string {
  return `wchat:hitl:${sessionId}:${toolCallId}`;
}

function pendingPrefix(sessionId: string): string {
  return `wchat:hitl:${sessionId}:`;
}

// resolved 마커는 pendingPrefix 로 스캔될 수 없는 별도 네임스페이스를 쓴다
// (`wchat:hitl:resolved:...` 로 두면 sessionId="resolved" 스캔과 충돌 위험 + prefix 오염).
function resolvedKey(sessionId: string, toolCallId: string): string {
  return `wchat:hitlres:${sessionId}:${toolCallId}`;
}

const HITL_RESOLVE_CHANNEL = "wchat:hitl:resolve";
// 중복 응답을 410 gone 으로 판정하기 위한 마커 수명.
const RESOLVED_TTL_SECONDS = 3600;

interface HitlResolvePayload {
  sessionId: string;
  toolCallId: string;
  decision: "approved" | "denied";
  modifiedArgs?: Record<string, unknown>;
  reason?: string;
}

function toDecision(input: {
  decision: "approved" | "denied";
  modifiedArgs?: Record<string, unknown>;
  reason?: string;
}): HitlDecision {
  return input.decision === "approved"
    ? {
        kind: "approved",
        ...(input.modifiedArgs ? { modifiedArgs: input.modifiedArgs } : {}),
      }
    : {
        kind: "denied",
        ...(input.reason ? { reason: input.reason } : {}),
      };
}

export type HitlResolveResult = "resolved" | "not_found" | "gone";

export interface PendingHitlSummary {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  requestedAt: string;
  expiresAt: string;
}

export interface HitlManager {
  bridge: HitlBridge;
  resolveHitl(
    sessionId: string,
    toolCallId: string,
    input: {
      decision: "approved" | "denied";
      modifiedArgs?: Record<string, unknown>;
      reason?: string;
    },
  ): Promise<HitlResolveResult>;
  listPendingHitl(sessionId: string): Promise<PendingHitlSummary[]>;
  close(): Promise<void>;
}

export function createHitlManager(bus: RuntimeBus): HitlManager {
  // 이 인스턴스가 실제로 들고 있는 승인 대기(settle 콜백은 직렬화 불가 → 로컬 전용).
  const pending = new Map<string, PendingEntry>();
  // resolveHitl 로 이미 응답된 toolCallId — 중복 응답을 404 대신 410 로 구분하기 위함
  // (timeout/abort 는 여기 추가하지 않음 — 그 경우는 "요청 자체가 더 없음" = 404 유지).
  const resolvedKeys = new Set<string>();

  let unsubscribe: (() => Promise<void>) | undefined;
  let subscribing: Promise<void> | undefined;

  // 다른 인스턴스가 publish 한 결정을 이 인스턴스의 로컬 pending 에 적용.
  function ensureSubscribed(): Promise<void> {
    if (subscribing) return subscribing;
    subscribing = bus
      .subscribe(HITL_RESOLVE_CHANNEL, (payload) => {
        let message: HitlResolvePayload;
        try {
          message = JSON.parse(payload) as HitlResolvePayload;
        } catch {
          return;
        }
        const k = key(message.sessionId, message.toolCallId);
        const entry = pending.get(k);
        if (!entry) return;
        resolvedKeys.add(k);
        entry.settle(toDecision(message));
      })
      .then((off) => {
        unsubscribe = off;
      });
    return subscribing;
  }

  const bridge: HitlBridge = {
    askApproval(input, signal) {
      const k = key(input.sessionId, input.toolCallId);
      const pk = pendingKey(input.sessionId, input.toolCallId);
      const timeoutMs = input.timeoutMs ?? 300_000;
      const summary: PendingHitlSummary = {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        args: input.args,
        rationale: input.rationale,
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
      };
      // 로컬 등록은 반드시 동기적으로 끝낸다(기존 semantics: askApproval 직후 resolveHitl 가능).
      const state = { settled: false };
      // 공유 key 쓰기는 비동기 — settle/abort 시 이 write 뒤에 del 을 체이닝해 경합을 없앤다.
      let sharedWrite: Promise<unknown> = Promise.resolve();
      const forgetShared = (): void => {
        void sharedWrite.then(() => bus.del(pk)).catch(() => undefined);
      };

      const decisionPromise = new Promise<HitlDecision>((resolve, reject) => {
        const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

        function finish(decision: HitlDecision): void {
          if (state.settled) return;
          state.settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          pending.delete(k);
          forgetShared();
          resolve(decision);
        }

        function onAbort(): void {
          if (state.settled) return;
          state.settled = true;
          clearTimeout(timer);
          pending.delete(k);
          forgetShared();
          reject(new DOMException("Aborted", "AbortError"));
        }

        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });

        pending.set(k, {
          sessionId: input.sessionId,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          args: input.args,
          rationale: input.rationale,
          requestedAt: summary.requestedAt,
          expiresAt: summary.expiresAt,
          settle: finish,
        });
      });

      // 이미 settle 됐으면(동기 abort) 공유 key 를 쓰지 않는다.
      sharedWrite = (async () => {
        await ensureSubscribed();
        if (state.settled) return;
        await bus.set(
          pk,
          JSON.stringify(summary),
          Math.max(1, Math.ceil(timeoutMs / 1000)),
        );
      })();

      // 구독 준비 전에 reject 될 수 있으므로 unhandled rejection 을 막아둔다.
      decisionPromise.catch(() => undefined);
      return sharedWrite.then(() => decisionPromise);
    },
  };

  return {
    bridge,

    async resolveHitl(sessionId, toolCallId, input) {
      const k = key(sessionId, toolCallId);
      const entry = pending.get(k);
      if (entry) {
        // 이 인스턴스가 소유 → 로컬에서 바로 settle (기존 동작 그대로).
        resolvedKeys.add(k);
        entry.settle(toDecision(input));
        await bus.set(
          resolvedKey(sessionId, toolCallId),
          "1",
          RESOLVED_TTL_SECONDS,
        );
        return "resolved";
      }

      // 로컬에 없으면 다른 인스턴스가 들고 있을 수 있다 — 공유 key 로 존재 확인 후 팬아웃.
      const pk = pendingKey(sessionId, toolCallId);
      if ((await bus.get(pk)) !== null) {
        resolvedKeys.add(k);
        await bus.set(
          resolvedKey(sessionId, toolCallId),
          "1",
          RESOLVED_TTL_SECONDS,
        );
        const payload: HitlResolvePayload = {
          sessionId,
          toolCallId,
          decision: input.decision,
          ...(input.modifiedArgs ? { modifiedArgs: input.modifiedArgs } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        };
        await bus.publish(HITL_RESOLVE_CHANNEL, JSON.stringify(payload));
        await bus.del(pk);
        return "resolved";
      }

      if (resolvedKeys.has(k)) return "gone";
      return (await bus.get(resolvedKey(sessionId, toolCallId))) !== null
        ? "gone"
        : "not_found";
    },

    async listPendingHitl(sessionId) {
      // 로컬 pending 이 authoritative — askApproval 은 로컬 등록을 **동기적으로** 끝내지만
      // 공유 key 쓰기는 비동기라, 공유 key 만 읽으면 방금 만들어진 승인 대기를 놓친다
      // (askApproval 직후 GET /hitl/pending 하는 기존 라우트 테스트가 정확히 이 경우).
      // 따라서 로컬 + 공유를 합치고 toolCallId 로 dedupe 한다(로컬 우선).
      const byToolCallId = new Map<string, PendingHitlSummary>();

      for (const entry of pending.values()) {
        if (entry.sessionId !== sessionId) continue;
        byToolCallId.set(entry.toolCallId, {
          toolCallId: entry.toolCallId,
          toolName: entry.toolName,
          args: entry.args,
          rationale: entry.rationale,
          requestedAt: entry.requestedAt,
          expiresAt: entry.expiresAt,
        });
      }

      // 다른 인스턴스에서 만들어진 승인 대기도 나열되도록 공유 key 를 스캔한다.
      for (const storeKey of await bus.keysWithPrefix(
        pendingPrefix(sessionId),
      )) {
        const raw = await bus.get(storeKey);
        if (raw === null) continue;
        try {
          const summary = JSON.parse(raw) as PendingHitlSummary;
          if (!byToolCallId.has(summary.toolCallId)) {
            byToolCallId.set(summary.toolCallId, summary);
          }
        } catch {
          // 손상된 항목은 무시(다른 승인 대기 조회를 막지 않는다).
        }
      }

      return [...byToolCallId.values()];
    },

    async close() {
      await unsubscribe?.();
      unsubscribe = undefined;
      subscribing = undefined;
      pending.clear();
      resolvedKeys.clear();
      // bus 자체는 소유자(app.ts)가 닫는다 — 프로세스 기본 인스턴스가 공유 bus 를 죽이지 않도록.
    },
  };
}

// ---------------------------------------------------------------------------
// 프로세스 기본 인스턴스 — 현재 활성 RuntimeBus 를 따라간다(app.ts 가 부팅 시 선택).
// ---------------------------------------------------------------------------

let cachedBus: RuntimeBus | undefined;
let cachedManager: HitlManager | undefined;

function defaultManager(): HitlManager {
  const bus = getRuntimeBus();
  if (!cachedManager || cachedBus !== bus) {
    cachedBus = bus;
    cachedManager = createHitlManager(bus);
  }
  return cachedManager;
}

export const hitlBridge: HitlBridge = {
  askApproval(input, signal) {
    return defaultManager().bridge.askApproval(input, signal);
  },
};

export function resolveHitl(
  sessionId: string,
  toolCallId: string,
  input: {
    decision: "approved" | "denied";
    modifiedArgs?: Record<string, unknown>;
    reason?: string;
  },
): Promise<HitlResolveResult> {
  return defaultManager().resolveHitl(sessionId, toolCallId, input);
}

export function listPendingHitl(
  sessionId: string,
): Promise<PendingHitlSummary[]> {
  return defaultManager().listPendingHitl(sessionId);
}

// hitl-manager.ts — 14-INTERFACES.md § 9 HitlBridge 단일 구현 지정 경로
// ("apps/server/src/tools/hitl-manager.ts 가 구현").
// LOCAL_ONLY: 실 Redis 미사용 — 단일 프로세스 in-memory Map(run-registry.ts 와 동일한
// 모듈 전역 싱글턴 패턴)으로 `hitl:{sessionId}:{toolCallId}` pending 큐를 재현.
// 배포 시 Redis-backed 구현으로 교체 가능하도록 HitlBridge 인터페이스만 노출.
import type { HitlBridge, HitlDecision } from "@wchat/interfaces";

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

const pending = new Map<string, PendingEntry>();
// resolveHitl 로 이미 응답된 toolCallId — 중복 응답을 404 대신 410 로 구분하기 위함
// (timeout/abort 는 여기 추가하지 않음 — 그 경우는 "요청 자체가 더 없음" = 404 유지).
const resolvedKeys = new Set<string>();

export const hitlBridge: HitlBridge = {
  askApproval(input, signal) {
    const k = key(input.sessionId, input.toolCallId);
    const timeoutMs = input.timeoutMs ?? 300_000;
    return new Promise<HitlDecision>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

      function finish(decision: HitlDecision) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        pending.delete(k);
        resolve(decision);
      }

      function onAbort() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(k);
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
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
        settle: finish,
      });
    });
  },
};

export type HitlResolveResult = "resolved" | "not_found" | "gone";

export function resolveHitl(
  sessionId: string,
  toolCallId: string,
  input: {
    decision: "approved" | "denied";
    modifiedArgs?: Record<string, unknown>;
    reason?: string;
  },
): HitlResolveResult {
  const k = key(sessionId, toolCallId);
  const entry = pending.get(k);
  if (!entry) {
    return resolvedKeys.has(k) ? "gone" : "not_found";
  }
  resolvedKeys.add(k);
  entry.settle(
    input.decision === "approved"
      ? {
          kind: "approved",
          ...(input.modifiedArgs ? { modifiedArgs: input.modifiedArgs } : {}),
        }
      : {
          kind: "denied",
          ...(input.reason ? { reason: input.reason } : {}),
        },
  );
  return "resolved";
}

export interface PendingHitlSummary {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rationale: string;
  requestedAt: string;
  expiresAt: string;
}

export function listPendingHitl(sessionId: string): PendingHitlSummary[] {
  return [...pending.values()]
    .filter((entry) => entry.sessionId === sessionId)
    .map(
      ({ toolCallId, toolName, args, rationale, requestedAt, expiresAt }) => ({
        toolCallId,
        toolName,
        args,
        rationale,
        requestedAt,
        expiresAt,
      }),
    );
}

// hitl-manager.test.ts — 14-INTERFACES.md § 9 HitlBridge 단일 구현
// (apps/server/src/tools/hitl-manager.ts) 단위 테스트.
import { describe, it, expect } from "vitest";
import {
  hitlBridge,
  resolveHitl,
  listPendingHitl,
  createHitlManager,
} from "../hitl-manager.js";
import {
  createInMemoryRuntimeBus,
  createInMemoryRuntimeStore,
} from "../../orchestrator/runtime-bus.js";

describe("hitl-manager — HitlBridge askApproval + resolveHitl + listPendingHitl", () => {
  it("askApproval 은 resolveHitl(approved) 호출 전까지 pending 상태로 대기하다 modifiedArgs 를 담아 resolve 한다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge.askApproval(
      {
        sessionId: "session-a",
        toolCallId: "call-a",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "위험한 작업",
        timeoutMs: 60_000,
      },
      controller.signal,
    );

    // askApproval 호출 직후에는 pending 목록에 노출돼야 한다.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await listPendingHitl("session-a")).toEqual([
      {
        toolCallId: "call-a",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "위험한 작업",
        requestedAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);

    const result = await resolveHitl("session-a", "call-a", {
      decision: "approved",
      modifiedArgs: { x: 2 },
    });
    expect(result).toBe("resolved");

    const decision = await promise;
    expect(decision).toEqual({ kind: "approved", modifiedArgs: { x: 2 } });
    // resolve 되면 pending 목록에서 사라진다.
    expect(await listPendingHitl("session-a")).toEqual([]);
  });

  it("resolveHitl(denied) 는 reason 을 담아 denied 로 resolve 한다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge.askApproval(
      {
        sessionId: "session-b",
        toolCallId: "call-b",
        toolName: "gated_tool",
        args: {},
        rationale: "위험한 작업",
      },
      controller.signal,
    );

    const result = await resolveHitl("session-b", "call-b", {
      decision: "denied",
      reason: "허용 안 함",
    });
    expect(result).toBe("resolved");
    expect(await promise).toEqual({ kind: "denied", reason: "허용 안 함" });
  });

  it("timeoutMs 경과 시 timeout 으로 resolve 된다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge.askApproval(
      {
        sessionId: "session-c",
        toolCallId: "call-c",
        toolName: "gated_tool",
        args: {},
        rationale: "위험한 작업",
        timeoutMs: 20,
      },
      controller.signal,
    );

    expect(await promise).toEqual({ kind: "timeout" });
  });

  it("존재하지 않는 toolCallId 에 대한 resolveHitl 은 not_found 를 반환한다", async () => {
    expect(
      await resolveHitl("session-d", "no-such-call", { decision: "approved" }),
    ).toBe("not_found");
  });

  it("이미 처리된 toolCallId 에 대한 중복 resolveHitl 은 gone 을 반환한다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge.askApproval(
      {
        sessionId: "session-e",
        toolCallId: "call-e",
        toolName: "gated_tool",
        args: {},
        rationale: "위험한 작업",
      },
      controller.signal,
    );
    expect(
      await resolveHitl("session-e", "call-e", { decision: "approved" }),
    ).toBe("resolved");
    await promise;
    expect(
      await resolveHitl("session-e", "call-e", { decision: "approved" }),
    ).toBe("gone");
  });

  it("signal abort 시 pending 요청이 취소되고 promise 가 reject 된다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge.askApproval(
      {
        sessionId: "session-f",
        toolCallId: "call-f",
        toolName: "gated_tool",
        args: {},
        rationale: "위험한 작업",
        timeoutMs: 60_000,
      },
      controller.signal,
    );
    controller.abort();
    await expect(promise).rejects.toThrow();
    expect(await listPendingHitl("session-f")).toEqual([]);
  });

  it("listPendingHitl 은 다른 세션의 pending 요청을 포함하지 않는다", async () => {
    const controller = new AbortController();
    const promise = hitlBridge
      .askApproval(
        {
          sessionId: "session-g",
          toolCallId: "call-g",
          toolName: "gated_tool",
          args: {},
          rationale: "위험한 작업",
          timeoutMs: 60_000,
        },
        controller.signal,
      )
      .catch(() => {
        // abort 로 인한 reject 는 이 테스트의 관심사가 아니다 — 정리용으로만 소비.
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await listPendingHitl("session-other")).toEqual([]);
    controller.abort();
    await promise;
  });
});

// ---------------------------------------------------------------------------
// P22-T2-03 — cross-instance: 같은 RuntimeBus store 를 공유하는 두 인스턴스(A/B).
// A 에서 만든 승인 요청을 B 가 조회/응답할 수 있어야 한다(다중 ECS task 시나리오).
// ---------------------------------------------------------------------------

function twoInstances(): {
  a: ReturnType<typeof createHitlManager>;
  b: ReturnType<typeof createHitlManager>;
  closeAll: () => Promise<void>;
} {
  const store = createInMemoryRuntimeStore();
  const a = createHitlManager(createInMemoryRuntimeBus(store));
  const b = createHitlManager(createInMemoryRuntimeBus(store));
  return {
    a,
    b,
    closeAll: async () => {
      await a.close();
      await b.close();
    },
  };
}

const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("hitl-manager — cross-instance HITL (RuntimeBus 공유)", () => {
  it("인스턴스 A 에서 생성한 pending 승인을 인스턴스 B 의 listPendingHitl 이 나열한다", async () => {
    const { a, b, closeAll } = twoInstances();
    const controller = new AbortController();
    const promise = a.bridge
      .askApproval(
        {
          sessionId: "x-session-1",
          toolCallId: "x-call-1",
          toolName: "gated_tool",
          args: { x: 1 },
          rationale: "다른 인스턴스에서 승인 대기",
          timeoutMs: 60_000,
        },
        controller.signal,
      )
      .catch(() => {
        // 정리용 abort reject 소비.
      });
    await tick();

    expect(await b.listPendingHitl("x-session-1")).toEqual([
      {
        toolCallId: "x-call-1",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "다른 인스턴스에서 승인 대기",
        requestedAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);

    controller.abort();
    await promise;
    // abort 되면 공유 목록에서도 사라진다.
    expect(await b.listPendingHitl("x-session-1")).toEqual([]);
    await closeAll();
  });

  it("인스턴스 B 의 resolveHitl(approved) 가 인스턴스 A 의 askApproval promise 를 settle 하고 양쪽 pending 목록에서 제거한다", async () => {
    const { a, b, closeAll } = twoInstances();
    const controller = new AbortController();
    const decision = a.bridge.askApproval(
      {
        sessionId: "x-session-2",
        toolCallId: "x-call-2",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "승인 필요",
        timeoutMs: 60_000,
      },
      controller.signal,
    );
    await tick();

    expect(
      await b.resolveHitl("x-session-2", "x-call-2", {
        decision: "approved",
        modifiedArgs: { x: 2 },
      }),
    ).toBe("resolved");

    expect(await decision).toEqual({
      kind: "approved",
      modifiedArgs: { x: 2 },
    });
    expect(await a.listPendingHitl("x-session-2")).toEqual([]);
    expect(await b.listPendingHitl("x-session-2")).toEqual([]);
    await closeAll();
  });

  it("인스턴스 B 의 resolveHitl(denied) 가 A 의 promise 를 denied 로 settle 하고, 중복 응답은 gone 을 반환한다", async () => {
    const { a, b, closeAll } = twoInstances();
    const controller = new AbortController();
    const decision = a.bridge.askApproval(
      {
        sessionId: "x-session-3",
        toolCallId: "x-call-3",
        toolName: "gated_tool",
        args: {},
        rationale: "거부 시나리오",
        timeoutMs: 60_000,
      },
      controller.signal,
    );
    await tick();

    expect(
      await b.resolveHitl("x-session-3", "x-call-3", {
        decision: "denied",
        reason: "정책 위반",
      }),
    ).toBe("resolved");
    expect(await decision).toEqual({ kind: "denied", reason: "정책 위반" });

    // 이미 처리됨 → 어느 인스턴스에서 다시 응답해도 gone.
    expect(
      await b.resolveHitl("x-session-3", "x-call-3", { decision: "approved" }),
    ).toBe("gone");
    expect(
      await a.resolveHitl("x-session-3", "x-call-3", { decision: "approved" }),
    ).toBe("gone");
    await closeAll();
  });

  it("resolved 마커가 listPendingHitl 결과를 오염시키지 않는다(prefix 충돌 가드)", async () => {
    const { a, b, closeAll } = twoInstances();
    const controller = new AbortController();
    const first = a.bridge.askApproval(
      {
        sessionId: "x-session-4",
        toolCallId: "x-call-4a",
        toolName: "gated_tool",
        args: {},
        rationale: "첫 번째",
        timeoutMs: 60_000,
      },
      controller.signal,
    );
    const second = a.bridge
      .askApproval(
        {
          sessionId: "x-session-4",
          toolCallId: "x-call-4b",
          toolName: "gated_tool",
          args: {},
          rationale: "두 번째",
          timeoutMs: 60_000,
        },
        controller.signal,
      )
      .catch(() => {
        // 정리용 abort reject 소비.
      });
    await tick();

    expect(
      await b.resolveHitl("x-session-4", "x-call-4a", { decision: "approved" }),
    ).toBe("resolved");
    expect(await first).toEqual({ kind: "approved" });

    // 남아 있는 pending 만 나열되고, resolved 마커는 절대 항목으로 새지 않는다.
    expect(await b.listPendingHitl("x-session-4")).toEqual([
      {
        toolCallId: "x-call-4b",
        toolName: "gated_tool",
        args: {},
        rationale: "두 번째",
        requestedAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);

    controller.abort();
    await second;
    await closeAll();
  });

  it("어느 인스턴스에도 없는 toolCallId 는 not_found 를 반환한다", async () => {
    const { b, closeAll } = twoInstances();
    expect(
      await b.resolveHitl("x-session-5", "no-such-call", {
        decision: "approved",
      }),
    ).toBe("not_found");
    await closeAll();
  });
});

// hitl-manager.test.ts — 14-INTERFACES.md § 9 HitlBridge 단일 구현
// (apps/server/src/tools/hitl-manager.ts) 단위 테스트.
import { describe, it, expect } from "vitest";
import { hitlBridge, resolveHitl, listPendingHitl } from "../hitl-manager.js";

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
    expect(listPendingHitl("session-a")).toEqual([
      {
        toolCallId: "call-a",
        toolName: "gated_tool",
        args: { x: 1 },
        rationale: "위험한 작업",
        requestedAt: expect.any(String),
        expiresAt: expect.any(String),
      },
    ]);

    const result = resolveHitl("session-a", "call-a", {
      decision: "approved",
      modifiedArgs: { x: 2 },
    });
    expect(result).toBe("resolved");

    const decision = await promise;
    expect(decision).toEqual({ kind: "approved", modifiedArgs: { x: 2 } });
    // resolve 되면 pending 목록에서 사라진다.
    expect(listPendingHitl("session-a")).toEqual([]);
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

    const result = resolveHitl("session-b", "call-b", {
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

  it("존재하지 않는 toolCallId 에 대한 resolveHitl 은 not_found 를 반환한다", () => {
    expect(
      resolveHitl("session-d", "no-such-call", { decision: "approved" }),
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
    expect(resolveHitl("session-e", "call-e", { decision: "approved" })).toBe(
      "resolved",
    );
    await promise;
    expect(resolveHitl("session-e", "call-e", { decision: "approved" })).toBe(
      "gone",
    );
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
    expect(listPendingHitl("session-f")).toEqual([]);
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
    expect(listPendingHitl("session-other")).toEqual([]);
    controller.abort();
    await promise;
  });
});

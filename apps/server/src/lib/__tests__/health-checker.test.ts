import { describe, it, expect } from "vitest";
import type { HealthCheckResult, HealthHistoryRepo } from "@wchat/interfaces";
import { checkHealth, runHealthChecks } from "../health-checker.js";
import { InMemoryAlertNotifier, triggerAlert } from "../alert-engine.js";
import type { AlertEvent, AlertEventRepo } from "@wchat/interfaces";

function fakeHealthHistoryRepo(): HealthHistoryRepo & {
  appended: HealthCheckResult[];
} {
  return {
    appended: [],
    async append(entry) {
      this.appended.push(entry);
    },
    async recent() {
      return [];
    },
  };
}

function fakeAlertEventRepo(): AlertEventRepo {
  return {
    async insert(data) {
      return {
        id: "alert-1",
        ruleId: data.ruleId ?? "",
        severity: data.severity ?? "info",
        message: data.message ?? "",
        payload: data.payload ?? {},
        createdAt: new Date(),
        resolvedAt: null,
      } satisfies AlertEvent;
    },
    async bulkInsert() {
      return [];
    },
    async update() {
      throw new Error("not implemented");
    },
    async delete() {
      throw new Error("not implemented");
    },
    async byId() {
      return null;
    },
    async list() {
      return { items: [] };
    },
    async resolve() {},
  };
}

describe("health-checker.checkHealth", () => {
  it("probe 가 성공하면 healthy 로 분류한다", async () => {
    const result = await checkHealth("postgres", async () => {});
    expect(result.status).toBe("healthy");
    expect(result.target).toBe("postgres");
    expect(result.latencyMs).not.toBeNull();
  });

  it("probe 지연이 threshold 를 넘으면 degraded 로 분류한다", async () => {
    const result = await checkHealth(
      "redis",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
      0,
    );
    expect(result.status).toBe("degraded");
  });

  it("probe 가 실패하면 down 으로 분류하고 latencyMs=null, context.error 를 채운다", async () => {
    const result = await checkHealth("e2b", async () => {
      throw new Error("connection refused");
    });
    expect(result.status).toBe("down");
    expect(result.latencyMs).toBeNull();
    expect(result.context).toEqual({ error: "connection refused" });
  });
});

describe("health-checker.runHealthChecks", () => {
  it("모든 대상을 실행해 HealthHistoryRepo 에 append 한다", async () => {
    const repo = fakeHealthHistoryRepo();

    const results = await runHealthChecks(repo, {
      postgres: async () => {},
      redis: async () => {},
    });

    expect(results).toHaveLength(2);
    expect(repo.appended).toHaveLength(2);
    expect(repo.appended.map((r) => r.target).sort()).toEqual([
      "postgres",
      "redis",
    ]);
  });

  it("down 상태인 target 에 대해 onUnhealthy 콜백을 호출한다 (alert-engine 연동)", async () => {
    const healthHistory = fakeHealthHistoryRepo();
    const alertRepo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    await runHealthChecks(
      healthHistory,
      {
        postgres: async () => {},
        e2b: async () => {
          throw new Error("timeout");
        },
      },
      async (result) => {
        await triggerAlert(alertRepo, notifier, {
          ruleId: `health-${result.target}-down`,
          severity: "critical",
          message: `${result.target} health check 실패`,
          payload: result.context ?? {},
        });
      },
    );

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.ruleId).toBe("health-e2b-down");
  });

  it("healthy 상태인 target 은 onUnhealthy 콜백을 호출하지 않는다", async () => {
    const healthHistory = fakeHealthHistoryRepo();
    let called = false;

    await runHealthChecks(
      healthHistory,
      { postgres: async () => {} },
      async () => {
        called = true;
      },
    );

    expect(called).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import type {
  AlertEvent,
  HealthCheckResult,
  HealthHistoryRepo,
} from "@wchat/interfaces";
import { startAlertingScheduler } from "../alerting-scheduler.js";
import { InMemoryAlertNotifier } from "../alert-engine.js";

function fakeHealthHistory(): Pick<HealthHistoryRepo, "append"> & {
  appended: HealthCheckResult[];
} {
  const appended: HealthCheckResult[] = [];
  return {
    appended,
    async append(entry) {
      appended.push(entry);
    },
  };
}

function fakeAlertEvents(): {
  insert: (d: Partial<AlertEvent>) => Promise<AlertEvent>;
} & {
  inserted: Partial<AlertEvent>[];
} {
  const inserted: Partial<AlertEvent>[] = [];
  return {
    inserted,
    async insert(data) {
      inserted.push(data);
      return {
        id: `alert-${inserted.length}`,
        ruleId: data.ruleId ?? "",
        severity: data.severity ?? "info",
        message: data.message ?? "",
        payload: data.payload ?? {},
        createdAt: new Date(0),
        resolvedAt: null,
      };
    },
  };
}

describe("startAlertingScheduler", () => {
  it("registers a periodic timer on start and clears it on stop (no leaked timers)", () => {
    let registeredFn: (() => void) | null = null;
    let registeredMs: number | null = null;
    const handles: symbol[] = [];
    const cleared: symbol[] = [];
    const token = Symbol("timer");

    const handle = startAlertingScheduler({
      healthHistory: fakeHealthHistory(),
      alertEvents: fakeAlertEvents(),
      notifier: new InMemoryAlertNotifier(),
      probes: {},
      intervalMs: 30_000,
      setTimer: (fn, ms) => {
        registeredFn = fn;
        registeredMs = ms;
        handles.push(token);
        return token;
      },
      clearTimer: (h) => {
        cleared.push(h as symbol);
      },
    });

    expect(typeof registeredFn).toBe("function");
    expect(registeredMs).toBe(30_000);
    expect(handles).toEqual([token]);
    expect(cleared).toEqual([]);

    handle.stop();
    expect(cleared).toEqual([token]);
  });

  it("triggers an alert to the notifier when a health probe fails on a tick", async () => {
    const healthHistory = fakeHealthHistory();
    const alertEvents = fakeAlertEvents();
    const notifier = new InMemoryAlertNotifier();

    const handle = startAlertingScheduler({
      healthHistory,
      alertEvents,
      notifier,
      probes: {
        db: () => Promise.reject(new Error("db down")),
      },
      setTimer: () => Symbol("noop"),
      clearTimer: () => {},
    });

    await handle.runTick();

    // health history persisted the down result
    expect(healthHistory.appended).toHaveLength(1);
    expect(healthHistory.appended[0]).toMatchObject({
      target: "db",
      status: "down",
    });

    // alert persisted + delivered to notifier
    expect(alertEvents.inserted).toHaveLength(1);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({
      ruleId: "health-target-unhealthy",
      severity: "critical",
    });
    expect(notifier.sent[0].payload).toMatchObject({
      target: "db",
      status: "down",
    });

    handle.stop();
  });

  it("does not alert when all probes are healthy on a tick", async () => {
    const healthHistory = fakeHealthHistory();
    const alertEvents = fakeAlertEvents();
    const notifier = new InMemoryAlertNotifier();

    const handle = startAlertingScheduler({
      healthHistory,
      alertEvents,
      notifier,
      probes: {
        db: () => Promise.resolve(),
        redis: () => Promise.resolve(),
      },
      setTimer: () => Symbol("noop"),
      clearTimer: () => {},
    });

    await handle.runTick();

    expect(healthHistory.appended.map((r) => r.status)).toEqual([
      "healthy",
      "healthy",
    ]);
    expect(alertEvents.inserted).toHaveLength(0);
    expect(notifier.sent).toHaveLength(0);

    handle.stop();
  });

  it("does not throw out of a tick even if a probe rejects", async () => {
    const handle = startAlertingScheduler({
      healthHistory: fakeHealthHistory(),
      alertEvents: fakeAlertEvents(),
      notifier: new InMemoryAlertNotifier(),
      probes: { db: () => Promise.reject(new Error("boom")) },
      setTimer: () => Symbol("noop"),
      clearTimer: () => {},
    });

    await expect(handle.runTick()).resolves.toBeUndefined();
    handle.stop();
  });
});

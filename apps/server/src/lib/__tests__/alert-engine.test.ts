import { describe, it, expect } from "vitest";
import type { AlertEvent, AlertEventRepo } from "@wchat/interfaces";
import {
  InMemoryAlertNotifier,
  createAlertNotifier,
  evaluateQuotaAlert,
  triggerAlert,
} from "../alert-engine.js";

function fakeAlertEventRepo(): AlertEventRepo & { inserted: AlertEvent[] } {
  const inserted: AlertEvent[] = [];
  return {
    inserted,
    async insert(data) {
      const event: AlertEvent = {
        id: `alert-${inserted.length + 1}`,
        ruleId: data.ruleId ?? "",
        severity: data.severity ?? "info",
        message: data.message ?? "",
        payload: data.payload ?? {},
        createdAt: new Date(),
        resolvedAt: data.resolvedAt ?? null,
      };
      inserted.push(event);
      return event;
    },
    async bulkInsert(rows) {
      const events = rows.map((r, i) => ({
        id: `alert-${inserted.length + i + 1}`,
        ruleId: r.ruleId ?? "",
        severity: r.severity ?? ("info" as const),
        message: r.message ?? "",
        payload: r.payload ?? {},
        createdAt: new Date(),
        resolvedAt: r.resolvedAt ?? null,
      }));
      inserted.push(...events);
      return events;
    },
    async update() {
      throw new Error("not implemented");
    },
    async delete() {
      throw new Error("not implemented");
    },
    async byId(id) {
      return inserted.find((e) => e.id === id) ?? null;
    },
    async list() {
      return { items: inserted };
    },
    async resolve() {
      throw new Error("not implemented");
    },
  };
}

describe("alert-engine.triggerAlert", () => {
  it("AlertEventRepo 에 영속화하고 notifier 로 Slack 알림을 발송한다", async () => {
    const repo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    const event = await triggerAlert(repo, notifier, {
      ruleId: "server-5xx",
      severity: "critical",
      message: "5xx rate > 1%",
      payload: { rate: 0.02 },
    });

    expect(repo.inserted).toEqual([event]);
    expect(notifier.sent).toEqual([
      {
        ruleId: "server-5xx",
        severity: "critical",
        message: "5xx rate > 1%",
        payload: { rate: 0.02 },
      },
    ]);
  });

  it("payload 미지정 시 빈 객체로 저장한다", async () => {
    const repo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    await triggerAlert(repo, notifier, {
      ruleId: "rds-cpu",
      severity: "warn",
      message: "RDS CPU > 85%",
    });

    expect(repo.inserted[0]?.payload).toEqual({});
  });
});

describe("alert-engine.evaluateQuotaAlert", () => {
  it("quotaStatus=ok 면 알림을 발송하지 않는다", async () => {
    const repo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    const result = await evaluateQuotaAlert(
      repo,
      notifier,
      "user-1",
      "ok",
      0.5,
    );

    expect(result).toBeNull();
    expect(notifier.sent).toEqual([]);
  });

  it("quotaStatus=warning 이면 warn severity 로 알림을 발송한다", async () => {
    const repo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    const result = await evaluateQuotaAlert(
      repo,
      notifier,
      "user-1",
      "warning",
      0.95,
    );

    expect(result?.severity).toBe("warn");
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.ruleId).toBe("quota-near-limit");
  });

  it("quotaStatus=blocked 이면 critical severity 로 알림을 발송한다", async () => {
    const repo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    const result = await evaluateQuotaAlert(
      repo,
      notifier,
      "user-1",
      "blocked",
      1,
    );

    expect(result?.severity).toBe("critical");
  });
});

describe("alert-engine.createAlertNotifier", () => {
  it("kind='test' 면 InMemoryAlertNotifier 를 반환한다", () => {
    const notifier = createAlertNotifier("test");
    expect(notifier).toBeInstanceOf(InMemoryAlertNotifier);
  });

  it("kind='slack' 이고 webhook URL 미설정이면 에러를 던진다", () => {
    const prev = process.env.ALERT_SLACK_WEBHOOK_URL;
    delete process.env.ALERT_SLACK_WEBHOOK_URL;
    expect(() => createAlertNotifier("slack")).toThrow(
      "ALERT_SLACK_WEBHOOK_URL",
    );
    if (prev !== undefined) process.env.ALERT_SLACK_WEBHOOK_URL = prev;
  });

  it("알 수 없는 kind 는 에러를 던진다", () => {
    expect(() => createAlertNotifier("bogus")).toThrow(
      "Unknown ALERT_NOTIFIER_KIND",
    );
  });
});

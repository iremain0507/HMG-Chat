import { describe, it, expect } from "vitest";
import type {
  UsageLogEntry,
  UsageLogRepo,
  UserQuotaInfo,
  UserQuotaRepo,
} from "@wchat/interfaces";
import { WChatError } from "@wchat/interfaces";
import { logUsage } from "../usage-logger.js";

function usageEntry(overrides: Partial<UsageLogEntry> = {}): UsageLogEntry {
  return {
    userId: "user-1",
    orgId: "org-1",
    sessionId: null,
    provider: "anthropic",
    model: "claude-sonnet-5",
    tokensIn: 100,
    tokensOut: 200,
    costMicros: 50,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeUsageLogRepo(): UsageLogRepo & { appended: UsageLogEntry[] } {
  return {
    appended: [],
    async append(entry) {
      this.appended.push(entry);
    },
    async list() {
      return { items: this.appended };
    },
    async aggregate() {
      return { tokensIn: 0, tokensOut: 0, costMicros: 0 };
    },
  };
}

function fakeUserQuotaRepo(record: UserQuotaInfo | null): UserQuotaRepo {
  let current = record;
  return {
    async byUserId() {
      return current;
    },
    async upsert(info) {
      current = info;
      return info;
    },
    async consume(_userId, micros) {
      if (!current) throw new Error("no quota");
      current = { ...current, usedMicros: current.usedMicros + micros };
      return { remaining: current.budgetMicros - current.usedMicros };
    },
    async refund(_userId, micros) {
      if (!current) throw new Error("no quota");
      current = { ...current, usedMicros: current.usedMicros - micros };
    },
    async list() {
      return { items: current ? [current] : [] };
    },
  };
}

describe("usage-logger.logUsage", () => {
  it("usage_logs 에 append 하고 quota 를 소진한 뒤 갱신된 quota 상태를 반환한다", async () => {
    const usageLogs = fakeUsageLogRepo();
    const userQuotas = fakeUserQuotaRepo({
      userId: "user-1",
      budgetMicros: 1000,
      usedMicros: 0,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-02-01T00:00:00Z"),
    });
    const entry = usageEntry({ costMicros: 100 });

    const result = await logUsage({ usageLogs, userQuotas }, entry);

    expect(usageLogs.appended).toEqual([entry]);
    expect(result.usedMicros).toBe(100);
    expect(result.status).toBe("ok");
  });

  it("quota 가 이미 100% 소진된 사용자는 WChatError(rate-limit) 를 던지고 로그를 append 하지 않는다", async () => {
    const usageLogs = fakeUsageLogRepo();
    const userQuotas = fakeUserQuotaRepo({
      userId: "user-1",
      budgetMicros: 100,
      usedMicros: 100,
      periodStart: new Date("2026-01-01T00:00:00Z"),
      periodEnd: new Date("2026-02-01T00:00:00Z"),
    });
    const entry = usageEntry({ costMicros: 10 });

    await expect(logUsage({ usageLogs, userQuotas }, entry)).rejects.toThrow(
      WChatError,
    );
    expect(usageLogs.appended).toEqual([]);
  });
});

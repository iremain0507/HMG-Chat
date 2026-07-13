import { describe, it, expect } from "vitest";
import type { UserQuotaInfo, UserQuotaRepo } from "@wchat/interfaces";
import { WChatError } from "@wchat/interfaces";
import {
  QUOTA_WARNING_RATIO,
  evaluateQuota,
  checkQuotaForUser,
  consumeQuota,
} from "../quota-service.js";

function quota(overrides: Partial<UserQuotaInfo>): UserQuotaInfo {
  return {
    userId: "user-1",
    budgetMicros: 1_000_000,
    usedMicros: 0,
    periodStart: new Date("2026-01-01T00:00:00Z"),
    periodEnd: new Date("2026-02-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeRepo(record: UserQuotaInfo | null): UserQuotaRepo & {
  consumed: Array<{ userId: string; micros: number }>;
} {
  let current = record;
  return {
    consumed: [],
    async byUserId() {
      return current;
    },
    async upsert(info) {
      current = info;
      return info;
    },
    async consume(userId, micros) {
      this.consumed.push({ userId, micros });
      if (!current) throw new Error("no quota");
      current = { ...current, usedMicros: current.usedMicros + micros };
      return { remaining: current.budgetMicros - current.usedMicros };
    },
    async refund(userId, micros) {
      if (!current) throw new Error("no quota");
      current = { ...current, usedMicros: current.usedMicros - micros };
    },
    async list() {
      return { items: current ? [current] : [] };
    },
  };
}

describe("quota-service.evaluateQuota", () => {
  it("사용량이 90% 미만이면 ok", () => {
    const result = evaluateQuota(quota({ budgetMicros: 100, usedMicros: 50 }));
    expect(result.status).toBe("ok");
    expect(result.percentUsed).toBeCloseTo(0.5);
    expect(result.remainingMicros).toBe(50);
  });

  it("사용량이 90% 이상 100% 미만이면 warning", () => {
    const result = evaluateQuota(quota({ budgetMicros: 100, usedMicros: 90 }));
    expect(result.status).toBe("warning");
  });

  it("사용량이 100% 이상이면 blocked", () => {
    const result = evaluateQuota(quota({ budgetMicros: 100, usedMicros: 100 }));
    expect(result.status).toBe("blocked");
  });

  it("경고 임계값 상수는 0.9 다", () => {
    expect(QUOTA_WARNING_RATIO).toBe(0.9);
  });
});

describe("quota-service.checkQuotaForUser", () => {
  it("quota 레코드가 없으면 null 반환", async () => {
    const repo = fakeRepo(null);
    const result = await checkQuotaForUser(repo, "user-1");
    expect(result).toBeNull();
  });

  it("quota 레코드가 있으면 evaluateQuota 결과 반환", async () => {
    const repo = fakeRepo(quota({ budgetMicros: 100, usedMicros: 95 }));
    const result = await checkQuotaForUser(repo, "user-1");
    expect(result?.status).toBe("warning");
  });
});

describe("quota-service.consumeQuota", () => {
  it("100% 미만이면 consume 호출 후 갱신된 상태를 반환한다", async () => {
    const repo = fakeRepo(quota({ budgetMicros: 100, usedMicros: 0 }));
    const result = await consumeQuota(repo, "user-1", 50);
    expect(result.status).toBe("ok");
    expect(result.usedMicros).toBe(50);
    expect(repo.consumed).toEqual([{ userId: "user-1", micros: 50 }]);
  });

  it("consume 후 90% 이상이 되면 warning 상태를 반환한다", async () => {
    const repo = fakeRepo(quota({ budgetMicros: 100, usedMicros: 80 }));
    const result = await consumeQuota(repo, "user-1", 15);
    expect(result.status).toBe("warning");
  });

  it("이미 100% 도달한 상태에서 호출하면 WChatError(rate-limit) 를 던지고 consume 을 호출하지 않는다", async () => {
    const repo = fakeRepo(quota({ budgetMicros: 100, usedMicros: 100 }));
    await expect(consumeQuota(repo, "user-1", 10)).rejects.toThrow(WChatError);
    await expect(consumeQuota(repo, "user-1", 10)).rejects.toMatchObject({
      category: "rate-limit",
    });
    expect(repo.consumed).toEqual([]);
  });

  it("quota 레코드가 없는 사용자는 WChatError(db) 를 던진다", async () => {
    const repo = fakeRepo(null);
    await expect(consumeQuota(repo, "user-1", 10)).rejects.toMatchObject({
      category: "db",
    });
  });
});

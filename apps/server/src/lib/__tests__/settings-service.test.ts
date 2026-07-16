import { describe, it, expect, vi, afterEach } from "vitest";
import { createSettingsService } from "../settings-service.js";
import { DEFAULT_ORG_SETTINGS } from "../org-settings-schema.js";
import type { OrgSettingsRecord } from "../../db/org-settings-data-access.js";
import type { Logger } from "@wchat/interfaces";

function mockDa(
  getByOrgId: (orgId: string) => Promise<OrgSettingsRecord | null>,
) {
  return { getByOrgId: vi.fn(getByOrgId) };
}

function mockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(function (this: Logger) {
      return this;
    }),
  };
}

function record(settings: Record<string, unknown>): OrgSettingsRecord {
  return {
    orgId: "org-1",
    settings,
    updatedBy: "user-1",
    updatedAt: new Date(),
  };
}

describe("settings-service.createSettingsService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("org_settings 행이 없으면 DEFAULT_ORG_SETTINGS 를 반환한다", async () => {
    const da = mockDa(async () => null);
    const svc = createSettingsService({ da });

    const resolved = await svc.resolve("org-1");

    expect(resolved).toEqual(DEFAULT_ORG_SETTINGS);
  });

  it("저장된 partial 을 DEFAULT_ORG_SETTINGS 위에 병합해 반환한다", async () => {
    const da = mockDa(async () =>
      record({ maxTokens: 8192, instanceName: "WIA Chat" }),
    );
    const svc = createSettingsService({ da });

    const resolved = await svc.resolve("org-1");

    expect(resolved).toEqual({
      ...DEFAULT_ORG_SETTINGS,
      maxTokens: 8192,
      instanceName: "WIA Chat",
    });
  });

  it("동일 orgId 2차 호출은 캐시를 사용해 DB 를 다시 호출하지 않는다", async () => {
    const da = mockDa(async () => record({ maxTokens: 2048 }));
    const svc = createSettingsService({ da });

    await svc.resolve("org-1");
    await svc.resolve("org-1");

    expect(da.getByOrgId).toHaveBeenCalledTimes(1);
  });

  it("invalidate 후에는 캐시를 무시하고 재조회한다", async () => {
    const da = mockDa(async () => record({ maxTokens: 2048 }));
    const svc = createSettingsService({ da });

    await svc.resolve("org-1");
    svc.invalidate("org-1");
    await svc.resolve("org-1");

    expect(da.getByOrgId).toHaveBeenCalledTimes(2);
  });

  it("TTL 경과 후에는 캐시가 만료되어 재조회한다", async () => {
    vi.useFakeTimers();
    const da = mockDa(async () => record({ maxTokens: 2048 }));
    const svc = createSettingsService({ da, ttlMs: 30_000 });

    await svc.resolve("org-1");
    vi.advanceTimersByTime(30_001);
    await svc.resolve("org-1");

    expect(da.getByOrgId).toHaveBeenCalledTimes(2);
  });

  it("DB 조회가 실패해도 throw 하지 않고 DEFAULT_ORG_SETTINGS 로 폴백 + warn 로깅한다", async () => {
    const da = mockDa(async () => {
      throw new Error("connection reset");
    });
    const logger = mockLogger();
    const svc = createSettingsService({ da, logger });

    const resolved = await svc.resolve("org-1");

    expect(resolved).toEqual(DEFAULT_ORG_SETTINGS);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ category: "db", orgId: "org-1" }),
    );
  });

  it("저장된 settings 가 스키마 검증에 실패하면(손상) DEFAULT 로 폴백 + warn 로깅한다", async () => {
    const da = mockDa(async () => record({ maxTokens: "not-a-number" }));
    const logger = mockLogger();
    const svc = createSettingsService({ da, logger });

    const resolved = await svc.resolve("org-1");

    expect(resolved).toEqual(DEFAULT_ORG_SETTINGS);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("서로 다른 orgId 는 독립적으로 캐시된다", async () => {
    const da = mockDa(async (orgId) =>
      orgId === "org-1"
        ? record({ maxTokens: 1111 })
        : record({ maxTokens: 2222 }),
    );
    const svc = createSettingsService({ da });

    const a = await svc.resolve("org-1");
    const b = await svc.resolve("org-2");

    expect(a.maxTokens).toBe(1111);
    expect(b.maxTokens).toBe(2222);
    expect(da.getByOrgId).toHaveBeenCalledTimes(2);
  });
});

import { describe, it, expect } from "vitest";
import type {
  AlertEvent,
  AlertEventRepo,
  ArtifactShareRecord,
  ArtifactStore,
  Organization,
  UploadRecord,
} from "@wchat/interfaces";
import {
  runRetention,
  ERROR_LOG_RETENTION_DAYS,
  HEALTH_HISTORY_RETENTION_DAYS,
  UPLOAD_RETENTION_DAYS,
  type RetentionDataAccess,
} from "../data-retention.js";
import { InMemoryAlertNotifier } from "../alert-engine.js";

function upload(overrides: Partial<UploadRecord> = {}): UploadRecord {
  return {
    id: "upload-1",
    userId: "user-1",
    sessionId: null,
    filename: "a.pdf",
    mimeType: "application/pdf",
    sizeBytes: 100,
    s3Key: "uploads/a.pdf",
    sha256: "abc",
    expiresAt: new Date(Date.now() - 1000),
    createdAt: new Date(),
    ...overrides,
  };
}

function share(
  overrides: Partial<ArtifactShareRecord> = {},
): ArtifactShareRecord {
  return {
    id: "share-1",
    artifactId: "artifact-1",
    token: "tok-1",
    issuedBy: "user-1",
    expiresAt: new Date(Date.now() - 1000),
    revokedAt: null,
    viewCount: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function org(overrides: Partial<Organization> = {}): Organization {
  return {
    id: "org-1",
    name: "Org",
    domain: "example.com",
    plan: "standard",
    allowedModels: [],
    allowedTools: [],
    defaultTokenBudgetMicros: null,
    retentionDays: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeDataAccess(opts: {
  expiredUploads?: UploadRecord[];
  shares?: ArtifactShareRecord[];
  uploadsDeleteFails?: boolean;
  orgs?: Organization[];
  errorLogDeletedCount?: number;
  healthHistoryDeletedCount?: number;
  messageDeletedCountByOrg?: Record<string, number>;
}): RetentionDataAccess & {
  deletedUploadIds: string[];
  revokedShareIds: string[];
  errorLogCutoffs: Date[];
  healthHistoryCutoffs: Date[];
  messageDeleteCalls: Array<{ cutoff: Date; orgId?: string }>;
} {
  const deletedUploadIds: string[] = [];
  const revokedShareIds: string[] = [];
  const errorLogCutoffs: Date[] = [];
  const healthHistoryCutoffs: Date[] = [];
  const messageDeleteCalls: Array<{ cutoff: Date; orgId?: string }> = [];
  const shares = opts.shares ?? [];

  return {
    deletedUploadIds,
    revokedShareIds,
    errorLogCutoffs,
    healthHistoryCutoffs,
    messageDeleteCalls,
    organizations: {
      async insert(data) {
        return org(data);
      },
      async bulkInsert(rows) {
        return rows.map((r) => org(r));
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
        return { items: opts.orgs ?? [] };
      },
    },
    errorLogs: {
      async append() {},
      async list() {
        return { items: [] };
      },
      async deleteOlderThan(cutoff) {
        errorLogCutoffs.push(cutoff);
        return opts.errorLogDeletedCount ?? 0;
      },
    },
    healthHistory: {
      async append() {},
      async recent() {
        return [];
      },
      async deleteOlderThan(cutoff) {
        healthHistoryCutoffs.push(cutoff);
        return opts.healthHistoryDeletedCount ?? 0;
      },
    },
    messages: {
      async insert() {
        throw new Error("not implemented");
      },
      async bulkInsert() {
        throw new Error("not implemented");
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
      async appendStream() {
        throw new Error("not implemented");
      },
      async deleteOlderThan(cutoff, orgId) {
        messageDeleteCalls.push({ cutoff, ...(orgId ? { orgId } : {}) });
        return orgId ? (opts.messageDeletedCountByOrg?.[orgId] ?? 0) : 0;
      },
    },
    uploads: {
      async insert(data) {
        return upload(data);
      },
      async bulkInsert(rows) {
        return rows.map((r) => upload(r));
      },
      async update() {
        throw new Error("not implemented");
      },
      async delete(id) {
        if (opts.uploadsDeleteFails) throw new Error("delete failed");
        deletedUploadIds.push(id);
      },
      async byId() {
        return null;
      },
      async list() {
        return { items: [] };
      },
      async bySha256() {
        return null;
      },
      async expiredOlderThan() {
        return opts.expiredUploads ?? [];
      },
    },
    artifactShares: {
      async insert(data) {
        return share(data);
      },
      async bulkInsert(rows) {
        return rows.map((r) => share(r));
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
        return { items: shares };
      },
      async byToken() {
        return null;
      },
      async incrementViewCount() {},
      async revoke(id) {
        revokedShareIds.push(id);
      },
    },
  };
}

function fakeArtifactStore(
  result: { deletedCount: number } = { deletedCount: 0 },
): Pick<ArtifactStore, "cleanupExpired"> {
  return {
    async cleanupExpired() {
      return result;
    },
  };
}

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
        resolvedAt: null,
      };
      inserted.push(event);
      return event;
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
      return { items: inserted };
    },
    async resolve() {},
  };
}

describe("data-retention.runRetention", () => {
  it("만료된 uploads 를 조회해 삭제한다", async () => {
    const expired = [upload({ id: "u-1" }), upload({ id: "u-2" })];
    const da = fakeDataAccess({ expiredUploads: expired });

    const results = await runRetention(da, fakeArtifactStore());

    expect(da.deletedUploadIds.sort()).toEqual(["u-1", "u-2"]);
    const step = results.find((r) => r.step === "expired-uploads");
    expect(step?.ok).toBe(true);
    expect(step?.detail).toEqual({ deletedCount: 2 });
  });

  it("artifactStore.cleanupExpired 를 호출한다", async () => {
    const da = fakeDataAccess({});
    const store = fakeArtifactStore({ deletedCount: 3 });

    const results = await runRetention(da, store);

    const step = results.find((r) => r.step === "artifact-store-cleanup");
    expect(step?.ok).toBe(true);
    expect(step?.detail).toEqual({ deletedCount: 3 });
  });

  it("만료되었고 revoke 안 된 artifact share 만 revoke 한다", async () => {
    const expiredShare = share({ id: "s-expired", revokedAt: null });
    const alreadyRevoked = share({
      id: "s-revoked",
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() - 1000),
    });
    const notYetExpired = share({
      id: "s-fresh",
      expiresAt: new Date(Date.now() + 100_000),
    });
    const da = fakeDataAccess({
      shares: [expiredShare, alreadyRevoked, notYetExpired],
    });

    const results = await runRetention(da, fakeArtifactStore());

    expect(da.revokedShareIds).toEqual(["s-expired"]);
    const step = results.find((r) => r.step === "expired-artifact-shares");
    expect(step?.detail).toEqual({ revokedCount: 1 });
  });

  it("일부 단계가 실패해도 나머지 단계는 계속 실행한다 (partial 실패 허용)", async () => {
    const da = fakeDataAccess({
      expiredUploads: [upload()],
      uploadsDeleteFails: true,
    });

    const results = await runRetention(da, fakeArtifactStore());

    const uploadStep = results.find((r) => r.step === "expired-uploads");
    expect(uploadStep?.ok).toBe(false);
    expect(uploadStep?.error).toBe("delete failed");
    const shareStep = results.find((r) => r.step === "expired-artifact-shares");
    expect(shareStep?.ok).toBe(true);
  });

  it("실패한 단계가 있으면 alerting 을 통해 Slack 알림을 발송한다", async () => {
    const da = fakeDataAccess({
      expiredUploads: [upload()],
      uploadsDeleteFails: true,
    });
    const alertRepo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    await runRetention(da, fakeArtifactStore(), {
      repo: alertRepo,
      notifier,
    });

    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.ruleId).toBe("data-retention-failure");
    expect(alertRepo.inserted).toHaveLength(1);
  });

  it("모든 단계가 성공하면 alerting 을 호출하지 않는다", async () => {
    const da = fakeDataAccess({});
    const alertRepo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    await runRetention(da, fakeArtifactStore(), {
      repo: alertRepo,
      notifier,
    });

    expect(notifier.sent).toEqual([]);
  });

  it("UPLOAD_RETENTION_DAYS 는 12-OPS-SECURITY.md 부록 H 기준 30일이다", () => {
    expect(UPLOAD_RETENTION_DAYS).toBe(30);
  });
});

// ── P22-T1-15 (계약배치 C2) — 부록 H 3·4·5 항: error_logs / health_history / messages ──
describe("data-retention.runRetention — 부록 H 3·4·5 보존기간 삭제", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("보존일수 상수는 부록 H 기준(error_logs 90일, health_history 30일)이다", () => {
    expect(ERROR_LOG_RETENTION_DAYS).toBe(90);
    expect(HEALTH_HISTORY_RETENTION_DAYS).toBe(30);
  });

  it("90일 지난 error_logs 를 삭제한다 (부록 H 4번)", async () => {
    const da = fakeDataAccess({ errorLogDeletedCount: 7 });
    const before = Date.now();

    const results = await runRetention(da, fakeArtifactStore());

    const step = results.find((r) => r.step === "expired-error-logs");
    expect(step?.ok).toBe(true);
    expect(step?.detail).toEqual({ deletedCount: 7 });
    expect(da.errorLogCutoffs).toHaveLength(1);
    const cutoff = da.errorLogCutoffs[0]!.getTime();
    expect(cutoff).toBeLessThanOrEqual(
      before - ERROR_LOG_RETENTION_DAYS * DAY_MS,
    );
    expect(cutoff).toBeGreaterThan(
      before - (ERROR_LOG_RETENTION_DAYS + 1) * DAY_MS,
    );
  });

  it("30일 지난 health_history 를 삭제한다 (부록 H 5번)", async () => {
    const da = fakeDataAccess({ healthHistoryDeletedCount: 12 });
    const before = Date.now();

    const results = await runRetention(da, fakeArtifactStore());

    const step = results.find((r) => r.step === "expired-health-history");
    expect(step?.ok).toBe(true);
    expect(step?.detail).toEqual({ deletedCount: 12 });
    expect(da.healthHistoryCutoffs).toHaveLength(1);
    const cutoff = da.healthHistoryCutoffs[0]!.getTime();
    expect(cutoff).toBeLessThanOrEqual(
      before - HEALTH_HISTORY_RETENTION_DAYS * DAY_MS,
    );
  });

  it("retentionDays 가 설정된 org 의 messages 만 org 별 cutoff 로 삭제한다 (부록 H 3번)", async () => {
    const da = fakeDataAccess({
      orgs: [
        org({ id: "org-30", retentionDays: 30 }),
        org({ id: "org-90", retentionDays: 90 }),
      ],
      messageDeletedCountByOrg: { "org-30": 4, "org-90": 2 },
    });
    const before = Date.now();

    const results = await runRetention(da, fakeArtifactStore());

    const step = results.find((r) => r.step === "org-message-retention");
    expect(step?.ok).toBe(true);
    expect(step?.detail).toEqual({
      deletedCount: 6,
      orgs: [
        { orgId: "org-30", deletedCount: 4 },
        { orgId: "org-90", deletedCount: 2 },
      ],
    });
    expect(da.messageDeleteCalls.map((c) => c.orgId)).toEqual([
      "org-30",
      "org-90",
    ]);
    expect(da.messageDeleteCalls[0]!.cutoff.getTime()).toBeLessThanOrEqual(
      before - 30 * DAY_MS,
    );
    expect(da.messageDeleteCalls[1]!.cutoff.getTime()).toBeLessThanOrEqual(
      before - 90 * DAY_MS,
    );
  });

  it("retentionDays 가 null 인 org 의 messages 는 절대 건드리지 않는다 (무기한 보존)", async () => {
    const da = fakeDataAccess({
      orgs: [
        org({ id: "org-keep", retentionDays: null }),
        org({ id: "org-purge", retentionDays: 30 }),
      ],
      messageDeletedCountByOrg: { "org-purge": 1 },
    });

    await runRetention(da, fakeArtifactStore());

    expect(da.messageDeleteCalls.map((c) => c.orgId)).toEqual(["org-purge"]);
  });

  it("메시지를 실제로 삭제한 org 에 대해서만 audit_log 를 남긴다", async () => {
    const recorded: Array<{
      orgId: string;
      action: string;
      metadata?: Record<string, unknown>;
    }> = [];
    const da = fakeDataAccess({
      orgs: [
        org({ id: "org-purge", retentionDays: 30 }),
        org({ id: "org-none", retentionDays: 30 }),
      ],
      messageDeletedCountByOrg: { "org-purge": 5, "org-none": 0 },
    });

    await runRetention(da, fakeArtifactStore(), undefined, {
      async record(input) {
        recorded.push({
          orgId: input.orgId,
          action: input.action,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        });
      },
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.orgId).toBe("org-purge");
    expect(recorded[0]!.action).toBe("data_retention.messages_purged");
    expect(recorded[0]!.metadata?.deletedCount).toBe(5);
  });

  it("error_logs 삭제가 실패해도 health_history/messages 단계는 계속 실행된다", async () => {
    const da = fakeDataAccess({
      orgs: [org({ id: "org-purge", retentionDays: 30 })],
      messageDeletedCountByOrg: { "org-purge": 1 },
    });
    da.errorLogs.deleteOlderThan = async () => {
      throw new Error("error_logs delete failed");
    };

    const results = await runRetention(da, fakeArtifactStore());

    expect(results.find((r) => r.step === "expired-error-logs")?.ok).toBe(
      false,
    );
    expect(results.find((r) => r.step === "expired-health-history")?.ok).toBe(
      true,
    );
    expect(results.find((r) => r.step === "org-message-retention")?.ok).toBe(
      true,
    );
  });
});

import { describe, it, expect } from "vitest";
import type {
  AlertEvent,
  AlertEventRepo,
  ArtifactShareRecord,
  ArtifactStore,
  UploadRecord,
} from "@wchat/interfaces";
import {
  runRetention,
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

function fakeDataAccess(opts: {
  expiredUploads?: UploadRecord[];
  shares?: ArtifactShareRecord[];
  uploadsDeleteFails?: boolean;
}): RetentionDataAccess & {
  deletedUploadIds: string[];
  revokedShareIds: string[];
} {
  const deletedUploadIds: string[] = [];
  const revokedShareIds: string[] = [];
  const shares = opts.shares ?? [];

  return {
    deletedUploadIds,
    revokedShareIds,
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

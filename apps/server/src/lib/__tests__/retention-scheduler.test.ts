import { describe, it, expect } from "vitest";
import type {
  AlertEvent,
  AlertEventRepo,
  ArtifactShareRecord,
  ArtifactStore,
  UploadRecord,
} from "@wchat/interfaces";
import { startRetentionScheduler } from "../retention-scheduler.js";
import type { RetentionDataAccess } from "../data-retention.js";
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
    // 부록 H 3·4·5 단계(P22-T1-15) — 스케줄러 테스트는 forwarding 만 보므로 최소 스텁.
    // 단계별 삭제 동작 자체는 data-retention.test.ts 가 단언한다.
    errorLogs: {
      async append() {},
      async list() {
        return { items: [] };
      },
      async deleteOlderThan() {
        return 0;
      },
    },
    healthHistory: {
      async append() {},
      async recent() {
        return [];
      },
      async deleteOlderThan() {
        return 0;
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
      async deleteOlderThan() {
        return 0;
      },
    },
    organizations: {
      async insert() {
        throw new Error("not implemented");
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
    },
  };
}

function fakeArtifactStore(): Pick<ArtifactStore, "cleanupExpired"> & {
  cleanupCalls: number;
} {
  const state = {
    cleanupCalls: 0,
    async cleanupExpired() {
      state.cleanupCalls++;
      return { deletedCount: 0 };
    },
  };
  return state;
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

// 2026-07-18T00:00:00Z is 2026-07-18 09:00 KST (KST=UTC+9).
const UTC_MIDNIGHT_2026_07_18 = Date.UTC(2026, 6, 18, 0, 0, 0);

describe("startRetentionScheduler", () => {
  it("registers a one-shot daily timer on start and clears it on stop (no leaked timers)", () => {
    let registeredFn: (() => void) | null = null;
    let registeredMs: number | null = null;
    const token = Symbol("timer");
    const cleared: symbol[] = [];

    const handle = startRetentionScheduler({
      da: fakeDataAccess({}),
      artifactStore: fakeArtifactStore(),
      now: () => UTC_MIDNIGHT_2026_07_18,
      setTimer: (fn, ms) => {
        registeredFn = fn;
        registeredMs = ms;
        return token;
      },
      clearTimer: (h) => {
        cleared.push(h as symbol);
      },
    });

    expect(typeof registeredFn).toBe("function");
    // must be a positive delay within a single day
    expect(registeredMs).toBeGreaterThan(0);
    expect(registeredMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(cleared).toEqual([]);

    handle.stop();
    expect(cleared).toEqual([token]);
  });

  it("schedules the first run at the next 03:00 KST from the injected clock", () => {
    // now = 09:00 KST → next 03:00 KST is 18h away.
    let registeredMs = 0;
    startRetentionScheduler({
      da: fakeDataAccess({}),
      artifactStore: fakeArtifactStore(),
      now: () => UTC_MIDNIGHT_2026_07_18, // 09:00 KST
      setTimer: (_fn, ms) => {
        registeredMs = ms;
        return Symbol("t");
      },
      clearTimer: () => {},
    });
    expect(registeredMs).toBe(18 * 60 * 60 * 1000);
  });

  it("runs runRetention on a tick: deletes expired uploads, cleans the store, revokes expired shares, and returns RetentionStepResult[]", async () => {
    const da = fakeDataAccess({
      expiredUploads: [upload({ id: "u-1" }), upload({ id: "u-2" })],
      shares: [share({ id: "s-expired" })],
    });
    const store = fakeArtifactStore();

    const handle = startRetentionScheduler({
      da,
      artifactStore: store,
      setTimer: () => Symbol("noop"),
      clearTimer: () => {},
    });

    const results = await handle.runTick();

    expect(da.deletedUploadIds.sort()).toEqual(["u-1", "u-2"]);
    expect(store.cleanupCalls).toBe(1);
    expect(da.revokedShareIds).toEqual(["s-expired"]);
    // P22-T1-15(계약배치 C2) 이후 부록 H 3·4·5 단계가 추가됐다.
    expect(results?.map((r) => r.step)).toEqual([
      "expired-uploads",
      "artifact-store-cleanup",
      "expired-artifact-shares",
      "expired-error-logs",
      "expired-health-history",
      "org-message-retention",
    ]);

    handle.stop();
  });

  it("does not crash and triggers a data-retention-failure alert when a step throws", async () => {
    const da = fakeDataAccess({
      expiredUploads: [upload()],
      uploadsDeleteFails: true,
    });
    const alertRepo = fakeAlertEventRepo();
    const notifier = new InMemoryAlertNotifier();

    const handle = startRetentionScheduler({
      da,
      artifactStore: fakeArtifactStore(),
      alerting: { repo: alertRepo, notifier },
      setTimer: () => Symbol("noop"),
      clearTimer: () => {},
    });

    await expect(handle.runTick()).resolves.toBeDefined();
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]?.ruleId).toBe("data-retention-failure");
    expect(alertRepo.inserted).toHaveLength(1);

    handle.stop();
  });

  it("re-arms the timer for the next day after a scheduled tick fires", async () => {
    const setCalls: number[] = [];
    let firstFn: (() => void) | null = null;

    startRetentionScheduler({
      da: fakeDataAccess({}),
      artifactStore: fakeArtifactStore(),
      now: () => UTC_MIDNIGHT_2026_07_18,
      setTimer: (fn, ms) => {
        setCalls.push(ms);
        if (firstFn === null) firstFn = fn;
        return Symbol("t");
      },
      clearTimer: () => {},
    });

    expect(setCalls).toHaveLength(1);
    // fire the scheduled callback (a tick), which must schedule the next day.
    firstFn!();
    // flush all microtasks + a macrotask so the async tick fully settles.
    await new Promise((resolve) => setImmediate(resolve));

    expect(setCalls.length).toBe(2);
  });
});

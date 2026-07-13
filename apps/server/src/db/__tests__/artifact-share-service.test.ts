// db/__tests__/artifact-share-service.test.ts — P6-T1-01 acceptance 단위: 토큰 발급(ttlDays
// 기본 30/최대 90) + 발급자 격리(다른 유저 조회/revoke 불가, existence-leak 방지) + 만료/revoke 시
// public 조회가 GONE. InMemory ArtifactShareDataAccess — 09-TDD-GUIDE.md § Mock vs Real 정책
// (unit test, 실 Postgres 불요. RLS org-boundary 는 __tests__/integration/rls-artifact-shares.test.ts).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactShareRecord } from "@wchat/interfaces";
import {
  createArtifactShareService,
  ArtifactShareServiceError,
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  type ArtifactShareDataAccess,
} from "../artifact-share-service.js";

function makeInMemoryArtifactShareDataAccess(): ArtifactShareDataAccess {
  const rows = new Map<string, ArtifactShareRecord>();
  return {
    artifactShares: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          token: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactShareRecord;
        rows.set(row.id, row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const existing = rows.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data };
        rows.set(id, updated);
        return updated;
      },
      async delete(id) {
        rows.delete(id);
      },
      async byId(id) {
        return rows.get(id) ?? null;
      },
      async list(filter) {
        const items = [...rows.values()].filter(
          (r) => !filter?.artifactId || r.artifactId === filter.artifactId,
        );
        return { items };
      },
      async byToken(token) {
        return [...rows.values()].find((r) => r.token === token) ?? null;
      },
      async incrementViewCount(token) {
        const found = [...rows.values()].find((r) => r.token === token);
        if (found) found.viewCount += 1;
      },
      async revoke(id) {
        const found = rows.get(id);
        if (found) found.revokedAt = new Date();
      },
    },
  };
}

describe("artifact-share-service", () => {
  let da: ArtifactShareDataAccess;
  const issuer = randomUUID();
  const outsider = randomUUID();
  const artifactId = randomUUID();

  beforeEach(() => {
    da = makeInMemoryArtifactShareDataAccess();
  });

  it("ttlDays 를 지정하지 않으면 기본 30일로 발급한다", async () => {
    const service = createArtifactShareService(da);
    const before = Date.now();
    const share = await service.issueShare({ userId: issuer }, artifactId);
    expect(share.issuedBy).toBe(issuer);
    expect(share.artifactId).toBe(artifactId);
    expect(share.viewCount).toBe(0);
    expect(share.revokedAt).toBeNull();
    const expectedMs = before + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000;
    expect(share.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(share.expiresAt.getTime()).toBeLessThanOrEqual(expectedMs + 5000);
  });

  it("ttlDays 를 지정하면 해당 일수로 발급한다", async () => {
    const service = createArtifactShareService(da);
    const before = Date.now();
    const share = await service.issueShare({ userId: issuer }, artifactId, 7);
    const expectedMs = before + 7 * 24 * 60 * 60 * 1000;
    expect(share.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMs - 5000);
    expect(share.expiresAt.getTime()).toBeLessThanOrEqual(expectedMs + 5000);
  });

  it("ttlDays 가 90 초과면 INVALID_INPUT", async () => {
    const service = createArtifactShareService(da);
    await expect(
      service.issueShare({ userId: issuer }, artifactId, MAX_TTL_DAYS + 1),
    ).rejects.toThrow(ArtifactShareServiceError);
  });

  it("ttlDays 가 0 이하면 INVALID_INPUT", async () => {
    const service = createArtifactShareService(da);
    await expect(
      service.issueShare({ userId: issuer }, artifactId, 0),
    ).rejects.toThrow(ArtifactShareServiceError);
  });

  it("발급자 본인은 조회할 수 있다", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    const found = await service.getShareForActor({ userId: issuer }, share.id);
    expect(found?.id).toBe(share.id);
  });

  it("다른 유저는 조회할 수 없다 (existence-leak 방지)", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    const found = await service.getShareForActor(
      { userId: outsider },
      share.id,
    );
    expect(found).toBeNull();
  });

  it("발급자 본인은 revoke 할 수 있다", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    await service.revokeShare({ userId: issuer }, share.id);
    const found = await da.artifactShares.byId(share.id);
    expect(found?.revokedAt).not.toBeNull();
  });

  it("다른 유저가 revoke 시도하면 NOT_FOUND 에러", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    await expect(
      service.revokeShare({ userId: outsider }, share.id),
    ).rejects.toThrow(ArtifactShareServiceError);
  });

  it("유효한 토큰은 public 조회에서 share 를 반환한다", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    const resolved = await service.resolvePublicShare(share.token);
    expect(resolved.id).toBe(share.id);
  });

  it("존재하지 않는 토큰은 NOT_FOUND", async () => {
    const service = createArtifactShareService(da);
    await expect(
      service.resolvePublicShare("no-such-token"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("만료된 토큰은 GONE", async () => {
    vi.useFakeTimers();
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId, 1);
    vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);
    await expect(service.resolvePublicShare(share.token)).rejects.toMatchObject(
      { code: "GONE" },
    );
    vi.useRealTimers();
  });

  it("revoke 된 토큰은 GONE", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    await service.revokeShare({ userId: issuer }, share.id);
    await expect(service.resolvePublicShare(share.token)).rejects.toMatchObject(
      { code: "GONE" },
    );
  });

  it("recordView 는 view_count 를 증가시킨다", async () => {
    const service = createArtifactShareService(da);
    const share = await service.issueShare({ userId: issuer }, artifactId);
    await service.recordView(share.token);
    await service.recordView(share.token);
    const found = await da.artifactShares.byId(share.id);
    expect(found?.viewCount).toBe(2);
  });
});

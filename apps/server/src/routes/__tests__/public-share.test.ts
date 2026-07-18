// public-share.test.ts — P6-T4-01 RED: routes/public-share.ts 가 createPublicShareRoutes 를
// export 하지 않음. 16-API-CONTRACT § 8 GET /api/v1/share/:token(/content) — 인증 없이 접근
// 가능(auth 헤더/쿠키 미첨부), 만료 → 410, revoke 후 즉시 차단(410).
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord, ArtifactShareRecord } from "@wchat/interfaces";
import { Hono } from "hono";
import { createPublicShareRoutes } from "../public-share.js";
import { createArtifactShareService } from "../../db/artifact-share-service.js";
import { createInlineArtifactStore } from "../../lib/artifact-store.inline.js";
import { createS3ArtifactStore } from "../../lib/artifact-store.s3.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { ArtifactShareDataAccess } from "../../db/artifact-share-service.js";

function makeDa(): ArtifactDataAccess & ArtifactShareDataAccess {
  const artifacts: ArtifactRecord[] = [];
  const shares: ArtifactShareRecord[] = [];
  return {
    artifacts: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactRecord;
        artifacts.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = artifacts.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        artifacts[idx] = { ...artifacts[idx], ...data } as ArtifactRecord;
        return artifacts[idx];
      },
      async delete(id) {
        const idx = artifacts.findIndex((r) => r.id === id);
        if (idx !== -1) artifacts.splice(idx, 1);
      },
      async byId(id) {
        return artifacts.find((r) => r.id === id) ?? null;
      },
      async list() {
        return { items: artifacts };
      },
    },
    artifactShares: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          token: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactShareRecord;
        shares.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = shares.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        shares[idx] = { ...shares[idx], ...data } as ArtifactShareRecord;
        return shares[idx];
      },
      async delete(id) {
        const idx = shares.findIndex((r) => r.id === id);
        if (idx !== -1) shares.splice(idx, 1);
      },
      async byId(id) {
        return shares.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: shares.filter(
            (r) => !filter?.artifactId || r.artifactId === filter.artifactId,
          ),
        };
      },
      async byToken(token) {
        return shares.find((r) => r.token === token) ?? null;
      },
      async incrementViewCount(token) {
        const found = shares.find((r) => r.token === token);
        if (found) found.viewCount += 1;
      },
      async revoke(id) {
        const found = shares.find((r) => r.id === id);
        if (found) found.revokedAt = new Date();
      },
    },
  };
}

const issuer = randomUUID();

async function setup() {
  const da = makeDa();
  const artifact = await da.artifacts.insert({
    sessionId: null,
    createdBy: issuer,
    type: "markdown",
    filename: "note.md",
    mimeType: "text/markdown",
    sizeBytes: 5,
    storageKind: "inline",
    s3Key: null,
    inlineContent: Buffer.from("hello share"),
    sharedAt: null,
  });
  const shareService = createArtifactShareService(da);
  const app = new Hono();
  app.route(
    "/",
    createPublicShareRoutes({
      da,
      inlineStore: createInlineArtifactStore(da.artifacts),
      s3Store: createS3ArtifactStore(createInMemoryObjectStore()),
    }),
  );
  return { da, artifact, shareService, app };
}

describe("createPublicShareRoutes", () => {
  it("GET /:token — 인증 헤더/쿠키 없이 메타데이터를 조회한다", async () => {
    const { artifact, shareService, app } = await setup();
    const share = await shareService.issueShare(
      { userId: issuer },
      artifact.id,
    );

    const res = await app.request(`/${share.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { token: string; filename: string; revokedAt: string | null };
    };
    expect(body.data.token).toBe(share.token);
    expect(body.data.filename).toBe("note.md");
    expect(body.data.revokedAt).toBeNull();
  });

  it("GET /:token/content — 인증 없이 실 바이트를 받고 view_count 가 증가한다", async () => {
    const { da, artifact, shareService, app } = await setup();
    const share = await shareService.issueShare(
      { userId: issuer },
      artifact.id,
    );

    const res = await app.request(`/${share.token}/content`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello share");

    const updated = await da.artifactShares.byToken(share.token);
    expect(updated?.viewCount).toBe(1);
  });

  it("GET /:token — 존재하지 않는 토큰은 404", async () => {
    const { app } = await setup();
    const res = await app.request(`/${randomUUID()}`);
    expect(res.status).toBe(404);
  });

  it("GET /:token — 만료된 토큰은 410 Gone", async () => {
    vi.useFakeTimers();
    try {
      const { artifact, shareService, app } = await setup();
      const share = await shareService.issueShare(
        { userId: issuer },
        artifact.id,
        1,
      );
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

      const res = await app.request(`/${share.token}`);
      expect(res.status).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });

  it("GET /:token/content — 만료된 토큰은 410 Gone", async () => {
    vi.useFakeTimers();
    try {
      const { artifact, shareService, app } = await setup();
      const share = await shareService.issueShare(
        { userId: issuer },
        artifact.id,
        1,
      );
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

      const res = await app.request(`/${share.token}/content`);
      expect(res.status).toBe(410);
    } finally {
      vi.useRealTimers();
    }
  });

  it("revoke 후 즉시 GET /:token 은 410 Gone (재조회 유예 없음)", async () => {
    const { artifact, shareService, app } = await setup();
    const share = await shareService.issueShare(
      { userId: issuer },
      artifact.id,
    );

    // revoke 전엔 정상 접근 가능함을 먼저 확인.
    expect((await app.request(`/${share.token}`)).status).toBe(200);

    await shareService.revokeShare({ userId: issuer }, share.id);

    expect((await app.request(`/${share.token}`)).status).toBe(410);
    expect((await app.request(`/${share.token}/content`)).status).toBe(410);
  });

  it("만료된 토큰의 410 응답 body 는 reason='expired' 를 담는다", async () => {
    vi.useFakeTimers();
    try {
      const { artifact, shareService, app } = await setup();
      const share = await shareService.issueShare(
        { userId: issuer },
        artifact.id,
        1,
      );
      vi.advanceTimersByTime(2 * 24 * 60 * 60 * 1000);

      const res = await app.request(`/${share.token}`);
      expect(res.status).toBe(410);
      const body = (await res.json()) as { error: { reason?: string } };
      expect(body.error.reason).toBe("expired");
    } finally {
      vi.useRealTimers();
    }
  });

  it("revoke 된 토큰의 410 응답 body 는 reason='revoked' 를 담는다", async () => {
    const { artifact, shareService, app } = await setup();
    const share = await shareService.issueShare(
      { userId: issuer },
      artifact.id,
    );
    await shareService.revokeShare({ userId: issuer }, share.id);

    const res = await app.request(`/${share.token}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { reason?: string } };
    expect(body.error.reason).toBe("revoked");
  });
});

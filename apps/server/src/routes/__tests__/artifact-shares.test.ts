// artifact-shares.test.ts — P6-T4-01 RED: routes/artifact-shares.ts 가
// createArtifactShareRoutes 를 export 하지 않음. 16-API-CONTRACT § 8 — POST/:id/share,
// GET /:id/shares, DELETE /:id/share/:token 은 모두 artifact 소유자만 호출 가능
// (다른 유저의 artifact 는 404, existence-leak 방지).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord, ArtifactShareRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createArtifactShareRoutes } from "../artifact-shares.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { ArtifactShareDataAccess } from "../../db/artifact-share-service.js";

const APP_ORIGIN = "https://app.example.com";

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
      async list(filter) {
        return {
          items: artifacts.filter(
            (r) => !filter?.createdBy || r.createdBy === filter.createdBy,
          ),
        };
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

function appWith(
  da: ArtifactDataAccess & ArtifactShareDataAccess,
  userId: string,
) {
  const routes = createArtifactShareRoutes({ da, appOrigin: APP_ORIGIN });
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: userId,
      org: randomUUID(),
      role: "member",
      scope: "access",
      jti: "x",
    });
    await next();
  });
  app.route("/", routes);
  return app;
}

async function insertArtifact(
  da: ArtifactDataAccess,
  createdBy: string,
): Promise<ArtifactRecord> {
  return da.artifacts.insert({
    sessionId: null,
    createdBy,
    type: "markdown",
    filename: "note.md",
    mimeType: "text/markdown",
    sizeBytes: 5,
    storageKind: "inline",
    s3Key: null,
    inlineContent: Buffer.from("hello"),
    sharedAt: null,
  });
}

let userId: string;
let otherUserId: string;

beforeEach(() => {
  userId = randomUUID();
  otherUserId = randomUUID();
});

describe("createArtifactShareRoutes", () => {
  it("POST /:id/share — 소유자는 토큰과 url 을 발급받는다", async () => {
    const da = makeDa();
    const artifact = await insertArtifact(da, userId);
    const app = appWith(da, userId);

    const res = await app.request(`/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { token: string; url: string; expiresAt: string };
    };
    expect(body.data.url).toBe(`${APP_ORIGIN}/share/${body.data.token}`);
    expect(body.data.expiresAt).toBeTruthy();
  });

  it("POST /:id/share — 다른 유저의 artifact 는 404 (existence-leak 방지)", async () => {
    const da = makeDa();
    const artifact = await insertArtifact(da, otherUserId);
    const app = appWith(da, userId);

    const res = await app.request(`/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  it("GET /:id/shares — 소유자는 발급 목록을 조회한다", async () => {
    const da = makeDa();
    const artifact = await insertArtifact(da, userId);
    const app = appWith(da, userId);
    await app.request(`/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const res = await app.request(`/${artifact.id}/shares`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ token: string }> };
    expect(body.data).toHaveLength(1);
  });

  it("DELETE /:id/share/:token — 소유자는 즉시 revoke 한다", async () => {
    const da = makeDa();
    const artifact = await insertArtifact(da, userId);
    const app = appWith(da, userId);
    const issued = await app.request(`/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { data } = (await issued.json()) as { data: { token: string } };

    const res = await app.request(`/${artifact.id}/share/${data.token}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);

    const share = await da.artifactShares.byToken(data.token);
    expect(share?.revokedAt).not.toBeNull();
  });

  it("DELETE /:id/share/:token — 다른 유저는 revoke 할 수 없다 (404)", async () => {
    const da = makeDa();
    const artifact = await insertArtifact(da, userId);
    const ownerApp = appWith(da, userId);
    const issued = await ownerApp.request(`/${artifact.id}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const { data } = (await issued.json()) as { data: { token: string } };

    const outsiderApp = appWith(da, otherUserId);
    const res = await outsiderApp.request(
      `/${artifact.id}/share/${data.token}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(404);
  });
});

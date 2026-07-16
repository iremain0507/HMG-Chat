// artifacts.test.ts — P5-T4-01 RED: routes/artifacts.ts 가 createArtifactRoutes 를 export 하지 않음.
// 16-API-CONTRACT § 7 Artifacts — GET /:id (storageKind 별 downloadUrl 분기) + GET /:id/content
// (inline 은 바로 stream, s3 는 presigned-style signed token 60s 검증 후 stream — LOCAL_ONLY 라
// 실 S3 presigned 대신 HMAC 서명 만료 토큰으로 동일 계약을 에뮬레이션).
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { ArtifactRecord } from "@wchat/interfaces";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { Hono } from "hono";
import { createArtifactRoutes } from "../artifacts.js";
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import { createInlineArtifactStore } from "../../lib/artifact-store.inline.js";
import { createS3ArtifactStore } from "../../lib/artifact-store.s3.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";

const DOWNLOAD_SECRET = "test-artifact-download-secret";

function makeDa(rows: ArtifactRecord[] = []): ArtifactDataAccess {
  return {
    artifacts: {
      async insert(data) {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          ...data,
        } as ArtifactRecord;
        rows.push(row);
        return row;
      },
      async bulkInsert(items) {
        return Promise.all(items.map((r) => this.insert(r)));
      },
      async update(id, data) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx === -1) throw new Error("not found");
        rows[idx] = { ...rows[idx], ...data } as ArtifactRecord;
        return rows[idx];
      },
      async delete(id) {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx !== -1) rows.splice(idx, 1);
      },
      async byId(id) {
        return rows.find((r) => r.id === id) ?? null;
      },
      async list(filter) {
        return {
          items: rows.filter(
            (r) => !filter?.createdBy || r.createdBy === filter.createdBy,
          ),
        };
      },
    },
  };
}

function appWith(da: ArtifactDataAccess) {
  const objectStore = createInMemoryObjectStore();
  const routes = createArtifactRoutes({
    da,
    inlineStore: createInlineArtifactStore(da.artifacts),
    s3Store: createS3ArtifactStore(objectStore),
    downloadSecret: DOWNLOAD_SECRET,
  });
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
  return { app, objectStore };
}

let userId: string;
let otherUserId: string;

beforeEach(() => {
  userId = randomUUID();
  otherUserId = randomUUID();
});

describe("createArtifactRoutes", () => {
  it("GET /:id — inline artifact 는 downloadUrl=null", async () => {
    const da = makeDa();
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: userId,
      type: "markdown",
      filename: "note.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
      storageKind: "inline",
      s3Key: null,
      inlineContent: Buffer.from("hello"),
      sharedAt: null,
    });
    const { app } = appWith(da);

    const res = await app.request(`/${artifact.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { downloadUrl: string | null } };
    expect(body.data.downloadUrl).toBeNull();
  });

  it("GET /:id — s3 artifact 는 60초 만료 서명 downloadUrl 을 반환", async () => {
    const da = makeDa();
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: userId,
      type: "pptx",
      filename: "deck.pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      sizeBytes: 10 * 1024 * 1024,
      storageKind: "s3",
      s3Key: `artifacts/${randomUUID()}`,
      inlineContent: null,
      sharedAt: null,
    });
    const { app } = appWith(da);

    const res = await app.request(`/${artifact.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { downloadUrl: string } };
    expect(body.data.downloadUrl).toContain(`/${artifact.id}/content`);
    expect(body.data.downloadUrl).toMatch(/exp=\d+/);
    expect(body.data.downloadUrl).toMatch(/sig=[0-9a-f]+/);
  });

  it("GET /:id — 존재하지 않으면 404, 다른 생성자의 artifact 도 404 (existence-leak 방지)", async () => {
    const da = makeDa();
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: otherUserId,
      type: "markdown",
      filename: "note.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
      storageKind: "inline",
      s3Key: null,
      inlineContent: Buffer.from("hello"),
      sharedAt: null,
    });
    const { app } = appWith(da);

    expect((await app.request(`/${randomUUID()}`)).status).toBe(404);
    expect((await app.request(`/${artifact.id}`)).status).toBe(404);
  });

  it("GET /:id/content — inline artifact 는 토큰 없이 바이트를 바로 반환", async () => {
    const da = makeDa();
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: userId,
      type: "markdown",
      filename: "note.md",
      mimeType: "text/markdown",
      sizeBytes: 5,
      storageKind: "inline",
      s3Key: null,
      inlineContent: Buffer.from("hello"),
      sharedAt: null,
    });
    const { app } = appWith(da);

    const res = await app.request(`/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hello");
  });

  it("GET /:id/content — 한글 파일명도 200 (헤더 Latin1/ByteString 변환 에러 회귀 방지)", async () => {
    const da = makeDa();
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: userId,
      type: "markdown",
      filename: "데이터레이크_구축_가이드.md",
      mimeType: "text/markdown",
      sizeBytes: 6,
      storageKind: "inline",
      s3Key: null,
      inlineContent: Buffer.from("# 가이드"),
      sharedAt: null,
    });
    const { app } = appWith(da);

    const res = await app.request(`/${artifact.id}/content`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain(
      "filename*=UTF-8''",
    );
    expect(await res.text()).toBe("# 가이드");
  });

  it("GET /:id/content — s3 artifact 는 signed downloadUrl 로만 바이트 조회 가능", async () => {
    const da = makeDa();
    const objectStore = createInMemoryObjectStore();
    const s3Store = createS3ArtifactStore(objectStore);
    // insert() 가 발급하는 id 를 미리 알 수 없으므로, DB row 를 먼저 만들고 그 id 로 store 에 저장한다
    // (실제 흐름에선 routes 밖의 create 경로가 id 발급→ArtifactStore.put→DB insert 순서로 수행).
    const artifact = await da.artifacts.insert({
      sessionId: null,
      createdBy: userId,
      type: "other",
      filename: "large.bin",
      mimeType: "application/octet-stream",
      sizeBytes: 8,
      storageKind: "s3",
      s3Key: "placeholder",
      inlineContent: null,
      sharedAt: null,
    });
    const put = await s3Store.put({
      artifactId: artifact.id,
      content: Buffer.from("s3 bytes"),
      sizeBytes: 8,
      mimeType: "application/octet-stream",
    });
    await da.artifacts.update(artifact.id, { s3Key: put.locator });

    const routes = createArtifactRoutes({
      da,
      inlineStore: createInlineArtifactStore(da.artifacts),
      s3Store,
      downloadSecret: DOWNLOAD_SECRET,
    });
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

    // 토큰 없이 접근 → 400
    expect((await app.request(`/${artifact.id}/content`)).status).toBe(400);

    // GET /:id 로 downloadUrl 발급받아 사용 → 200
    const metaRes = await app.request(`/${artifact.id}`);
    const meta = (await metaRes.json()) as { data: { downloadUrl: string } };
    const contentRes = await app.request(meta.data.downloadUrl);
    expect(contentRes.status).toBe(200);
    expect(await contentRes.text()).toBe("s3 bytes");

    // 위조된 sig → 403
    const tampered = meta.data.downloadUrl.replace(
      /sig=[0-9a-f]+/,
      "sig=deadbeef",
    );
    expect((await app.request(tampered)).status).toBe(403);

    // 만료된 exp → 403
    const expired = meta.data.downloadUrl.replace(
      /exp=\d+/,
      `exp=${Date.now() - 1000}`,
    );
    expect((await app.request(expired)).status).toBe(403);
  });
});

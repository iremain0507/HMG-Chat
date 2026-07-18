// documents-chunk-settings.test.ts — P22-T3-04 acceptance.
// createDocumentRoutes 가 deps.settings(ChunkSettingsResolverPort)를 createDocumentService 로
// 실제 forward 하는지(=index 시점 org-scoped 청크 크기 반영)를 route 조립 계층에서 실 HTTP 로 검증.
// 실 Postgres 불요: InMemory DocumentDataAccess(document-da-fake) + auth 주입 미들웨어로 mount.
// 배선 결함(라우트가 deps.settings 를 흘려버림) 재발 방지 가드 — 단위테스트
// db/__tests__/document-service.test.ts:P16-T1-01 는 service 직접 주입만 검증했고, 이 파일은
// route→service 배선(app.ts → createDocumentRoutes → createDocumentService)의 seam 을 닫는다.
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { EmbeddingProvider } from "@wchat/interfaces";
import { createDocumentRoutes } from "../documents.js";
import type { ChunkSettingsResolverPort } from "../../db/document-service.js";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import type { ParserPipeline } from "../../knowledge/parser-types.js";
import { chunkText } from "../../knowledge/chunker.js";
import { createInMemoryObjectStore } from "../../lib/object-store.js";
import { makeInMemoryDocumentDataAccess } from "../../db/__tests__/document-da-fake.js";

const LONG_TEXT = "word ".repeat(3000).trim();

const longParserPipeline: ParserPipeline = {
  supports: () => true,
  async parse() {
    return { format: "docx", markdown: LONG_TEXT };
  },
};

const fakeEmbeddingProvider: EmbeddingProvider = {
  name: "fake",
  dim: 2,
  async embed(input) {
    return input.map(() => [0.1, 0.2]);
  },
};

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function setup(settings?: ChunkSettingsResolverPort) {
  const da = makeInMemoryDocumentDataAccess();
  const owner = { userId: randomUUID(), orgId: randomUUID() };
  const project = await da.projects.insert({
    orgId: owner.orgId,
    ownerId: owner.userId,
    name: "Chunk Settings Project",
    description: null,
    visibility: "private",
    orgUnitId: null,
  });
  await da.projectMembers.upsert({
    projectId: project.id,
    userId: owner.userId,
    role: "owner",
    createdAt: new Date(),
  });

  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", {
      sub: owner.userId,
      org: owner.orgId,
      role: "member",
    } as AuthedVariables["auth"]);
    await next();
  });
  app.route(
    "/",
    createDocumentRoutes({
      da,
      objectStore: createInMemoryObjectStore(),
      parserPipeline: longParserPipeline,
      embeddingProvider: fakeEmbeddingProvider,
      ...(settings ? { settings } : {}),
    }),
  );

  async function upload(filename: string): Promise<{
    status: number;
    chunkCount: number;
    indexStatus: string;
  }> {
    const form = new FormData();
    form.set("projectId", project.id);
    form.set(
      "file",
      new File([Buffer.from("bytes")], filename, {
        type: DOCX_MIME,
      }),
    );
    const res = await app.request("/", { method: "POST", body: form });
    const body = (await res.json()) as {
      data?: { chunkCount: number; indexStatus: string };
    };
    return {
      status: res.status,
      chunkCount: body.data?.chunkCount ?? -1,
      indexStatus: body.data?.indexStatus ?? "",
    };
  }

  return { upload };
}

describe("P22-T3-04 — createDocumentRoutes forwards org-scoped chunk settings", () => {
  it("org ragChunkSizeTokens=1200 이면 POST 인덱싱이 1200 기준으로 청킹한다(배선)", async () => {
    const settings: ChunkSettingsResolverPort = {
      async resolve() {
        return { ragChunkSizeTokens: 1200, ragChunkOverlapTokens: 100 };
      },
    };
    const { upload } = await setup(settings);
    const out = await upload("long-1200.docx");

    expect(out.status).toBe(201);
    const expected = chunkText(LONG_TEXT, {
      chunkSizeTokens: 1200,
      overlapTokens: 100,
    }).length;
    // RED before wiring: routes drops deps.settings -> service falls back to 800 default.
    expect(out.chunkCount).toBe(expected);
    expect(out.chunkCount).not.toBe(chunkText(LONG_TEXT).length);
  });

  it("settings 미주입 시 기본값(800)으로 청킹한다(back-compat)", async () => {
    const { upload } = await setup();
    const out = await upload("long-default.docx");

    expect(out.status).toBe(201);
    expect(out.chunkCount).toBe(chunkText(LONG_TEXT).length);
  });

  it("settings.resolve 가 실패해도 인덱싱은 기본값(800)으로 fail-soft 한다", async () => {
    const settings: ChunkSettingsResolverPort = {
      async resolve() {
        throw new Error("settings unavailable");
      },
    };
    const { upload } = await setup(settings);
    const out = await upload("long-failsoft.docx");

    expect(out.status).toBe(201);
    expect(out.indexStatus).toBe("indexed");
    expect(out.chunkCount).toBe(chunkText(LONG_TEXT).length);
  });
});

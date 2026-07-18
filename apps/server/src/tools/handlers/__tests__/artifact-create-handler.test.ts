import { describe, it, expect, vi } from "vitest";
import type {
  ArtifactRecord,
  ArtifactStore,
  ToolContext,
} from "@wchat/interfaces";
import { Readable } from "node:stream";
import { createArtifactCreateTool } from "../artifact-create-handler.js";
import type { ArtifactDataAccess } from "../../../db/artifact-service.js";
import { INLINE_STORAGE_THRESHOLD_BYTES } from "../../../db/artifact-service.js";

function fakeToolContext(overrides?: Partial<ToolContext>): ToolContext {
  const logger: ToolContext["logger"] = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  };
  return {
    requestId: "req-1",
    userId: "user-1",
    orgId: "org-1",
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger,
    hitl: {
      async askApproval() {
        return { kind: "approved" };
      },
    },
    budget: {
      async claim() {},
      async settle() {},
      async refund() {},
      remaining: Infinity,
    },
    ...overrides,
  };
}

function fakeArtifactDa(): ArtifactDataAccess {
  const store = new Map<string, ArtifactRecord>();
  let seq = 0;
  return {
    artifacts: {
      async insert(data) {
        seq += 1;
        const record: ArtifactRecord = {
          id: `artifact-${seq}`,
          sessionId: data.sessionId ?? null,
          createdBy: data.createdBy as string,
          type: data.type as ArtifactRecord["type"],
          filename: data.filename as string,
          mimeType: (data.mimeType as string | null) ?? null,
          sizeBytes: data.sizeBytes as number,
          storageKind:
            (data.storageKind as ArtifactRecord["storageKind"]) ?? "inline",
          s3Key: (data.s3Key as string | null) ?? null,
          inlineContent: (data.inlineContent as Buffer | null) ?? null,
          sharedAt: null,
          createdAt: new Date("2026-07-15T00:00:00Z"),
        };
        store.set(record.id, record);
        return record;
      },
      async bulkInsert() {
        return [];
      },
      async update(id, data) {
        const existing = store.get(id);
        if (!existing) throw new Error("not found");
        const updated: ArtifactRecord = {
          ...existing,
          ...(data.s3Key !== undefined
            ? { s3Key: (data.s3Key as string | null) ?? null }
            : {}),
        };
        store.set(id, updated);
        return updated;
      },
      async delete() {},
      async byId(id) {
        return store.get(id) ?? null;
      },
      async list() {
        return { items: [...store.values()] };
      },
    },
  };
}

function fakeS3Store(): ArtifactStore {
  const objects = new Map<string, Buffer>();
  return {
    async put(input) {
      const key = `artifacts/${input.artifactId}`;
      const buf = Buffer.isBuffer(input.content)
        ? input.content
        : Buffer.from([]);
      objects.set(key, buf);
      return { storageKind: "s3", locator: key };
    },
    async get(artifactId) {
      return Readable.from(
        objects.get(`artifacts/${artifactId}`) ?? Buffer.from([]),
      );
    },
    async getInline(artifactId) {
      return {
        content: objects.get(`artifacts/${artifactId}`) ?? Buffer.from([]),
        mimeType: "application/octet-stream",
        truncated: false,
      };
    },
    async remove(artifactId) {
      objects.delete(`artifacts/${artifactId}`);
    },
    async cleanupExpired() {
      return { deletedCount: 0 };
    },
  };
}

describe("createArtifactCreateTool", () => {
  it("spec 은 artifact_create 계약을 만족한다", () => {
    const tool = createArtifactCreateTool({ da: fakeArtifactDa() });

    expect(tool.spec.name).toBe("artifact_create");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
  });

  it("filename/type/content 가 유효하면 artifact 를 저장하고 artifactId/artifactKind/filename/sizeBytes/downloadUrl 을 json 결과로 반환한다", async () => {
    const tool = createArtifactCreateTool({ da: fakeArtifactDa() });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { filename: "notes.md", type: "markdown", content: "# hello" },
      ctx: fakeToolContext(),
    });

    expect(result.toolCallId).toBe("call-1");
    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      artifact: {
        artifactId: string;
        artifactKind: string;
        filename: string;
        sizeBytes: number;
        downloadUrl: string;
      };
    };
    expect(data.artifact.artifactId).toBe("artifact-1");
    expect(data.artifact.artifactKind).toBe("markdown");
    expect(data.artifact.filename).toBe("notes.md");
    expect(data.artifact.sizeBytes).toBeGreaterThan(0);
    expect(data.artifact.downloadUrl).toContain("artifact-1");
  });

  it("filename 이 비어있으면 error content 를 반환한다", async () => {
    const tool = createArtifactCreateTool({ da: fakeArtifactDa() });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { filename: "  ", type: "markdown", content: "hi" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
  });

  it("type 이 허용되지 않은 값이면 error content 를 반환한다", async () => {
    const tool = createArtifactCreateTool({ da: fakeArtifactDa() });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { filename: "a.exe", type: "exe", content: "hi" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
  });

  it("content 가 비어있으면 error content 를 반환한다", async () => {
    const tool = createArtifactCreateTool({ da: fakeArtifactDa() });

    const result = await tool.invoke({
      toolCallId: "call-4",
      args: { filename: "a.md", type: "markdown", content: "" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
  });

  it("content 가 256KB 이상이면 s3Store.put 으로 업로드하고 storageKind='s3'·inlineContent=null 로 저장한다", async () => {
    const da = fakeArtifactDa();
    const s3Store = fakeS3Store();
    const putSpy = vi.spyOn(s3Store, "put");
    const tool = createArtifactCreateTool({ da, s3Store });

    const bigContent = "x".repeat(INLINE_STORAGE_THRESHOLD_BYTES + 10);
    const result = await tool.invoke({
      toolCallId: "call-5",
      args: { filename: "big.md", type: "markdown", content: bigContent },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("json");
    expect(putSpy).toHaveBeenCalledTimes(1);

    const stored = (await da.artifacts.list()).items.at(-1) as ArtifactRecord;
    expect(stored.storageKind).toBe("s3");
    expect(stored.inlineContent).toBeNull();
    expect(stored.s3Key).toBeTruthy();
    // put 은 DB 가 생성한 row id 로 keying 되어야 retrieval(artifacts/${id}) 이 일치한다.
    expect(putSpy).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: stored.id }),
    );
    expect(stored.s3Key).toBe(`artifacts/${stored.id}`);
  });

  it("content 가 256KB 미만이면 기존처럼 inline 저장한다(회귀 방지)", async () => {
    const da = fakeArtifactDa();
    const s3Store = fakeS3Store();
    const putSpy = vi.spyOn(s3Store, "put");
    const tool = createArtifactCreateTool({ da, s3Store });

    const result = await tool.invoke({
      toolCallId: "call-6",
      args: { filename: "small.md", type: "markdown", content: "# tiny" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("json");
    expect(putSpy).not.toHaveBeenCalled();

    const stored = (await da.artifacts.list()).items.at(-1) as ArtifactRecord;
    expect(stored.storageKind).toBe("inline");
    expect(stored.s3Key).toBeNull();
    expect(stored.inlineContent).not.toBeNull();
  });
});

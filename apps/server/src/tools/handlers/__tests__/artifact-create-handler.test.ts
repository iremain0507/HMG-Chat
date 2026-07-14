import { describe, it, expect } from "vitest";
import type { ArtifactRecord, ToolContext } from "@wchat/interfaces";
import { createArtifactCreateTool } from "../artifact-create-handler.js";
import type { ArtifactDataAccess } from "../../../db/artifact-service.js";

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
      async update() {
        throw new Error("not implemented");
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
});

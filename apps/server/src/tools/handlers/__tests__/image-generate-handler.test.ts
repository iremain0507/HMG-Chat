// image-generate-handler.test.ts — image_generate AgentTool RED->GREEN.
//   web-search/artifact-create 핸들러 패턴을 따른다: dev-stub ImageGenPort 로 이미지를 생성해
//   artifact(kind image)로 저장하고, orchestrator 가 duck-typing 으로 artifact_created 로 펼치는
//   json { artifact: {...} } 결과를 반환한다(P22-T1-08). imageGenEnabled=false org 는 invoke
//   시점에 거절(org-scoped 게이트, web_search 의 invoke-time resolve 와 동일 seam).
import { describe, it, expect } from "vitest";
import type { ArtifactRecord, ToolContext } from "@wchat/interfaces";
import { WChatError } from "@wchat/interfaces";
import { createImageGenerateTool } from "../image-generate-handler.js";
import { createDevStubImageGenProvider } from "../../image-gen-provider-dev-stub.js";
import type { ImageGenPort } from "../../image-gen-port.js";
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
      async update(id, data) {
        const existing = store.get(id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...data } as ArtifactRecord;
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

describe("createImageGenerateTool", () => {
  it("spec 은 image_generate 계약(tool tier + tags media)을 만족한다", () => {
    const tool = createImageGenerateTool({
      port: createDevStubImageGenProvider(),
      da: fakeArtifactDa(),
    });
    expect(tool.spec.name).toBe("image_generate");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.tags).toEqual(expect.arrayContaining(["media"]));
    expect(tool.spec.inputSchema.required).toContain("prompt");
  });

  it("prompt 가 주어지면 dev-stub provider 로 이미지를 생성해 kind=image artifact 로 저장하고 artifact json 을 반환한다", async () => {
    const da = fakeArtifactDa();
    const tool = createImageGenerateTool({
      port: createDevStubImageGenProvider(),
      da,
    });

    const result = await tool.invoke({
      toolCallId: "tc-1",
      args: { prompt: "a red sports car" },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("json");
    const data = (result.content as { kind: "json"; data: unknown }).data as {
      artifact: Record<string, unknown>;
    };
    expect(data.artifact).toBeDefined();
    expect(data.artifact.artifactKind).toBe("image");
    expect(typeof data.artifact.artifactId).toBe("string");
    expect(typeof data.artifact.filename).toBe("string");
    expect(data.artifact.sizeBytes as number).toBeGreaterThan(0);
    expect(data.artifact.downloadUrl).toBe(
      `/api/v1/artifacts/${data.artifact.artifactId}/content`,
    );

    // 실제로 저장됐고 mimeType 이 이미지인지 단언(L1 — 실 저장 왕복).
    const stored = await da.artifacts.byId(data.artifact.artifactId as string);
    expect(stored?.type).toBe("image");
    expect(stored?.mimeType).toContain("image/");
  });

  it("prompt 가 비면 INVALID_INPUT 을 반환한다", async () => {
    const tool = createImageGenerateTool({
      port: createDevStubImageGenProvider(),
      da: fakeArtifactDa(),
    });
    const result = await tool.invoke({
      toolCallId: "tc-2",
      args: { prompt: "   " },
      ctx: fakeToolContext(),
    });
    expect(result.content.kind).toBe("error");
    expect(
      (result.content as { kind: "error"; error: WChatError }).error.code,
    ).toBe("INVALID_INPUT");
  });

  it("org imageGenEnabled=false 면 invoke 시점에 IMAGE_GEN_DISABLED 로 거절한다(org-scoped 게이트)", async () => {
    const tool = createImageGenerateTool({
      port: createDevStubImageGenProvider(),
      da: fakeArtifactDa(),
      settings: {
        async resolve() {
          return { imageGenEnabled: false };
        },
      },
    });
    const result = await tool.invoke({
      toolCallId: "tc-3",
      args: { prompt: "a cat" },
      ctx: fakeToolContext(),
    });
    expect(result.content.kind).toBe("error");
    expect(
      (result.content as { kind: "error"; error: WChatError }).error.code,
    ).toBe("IMAGE_GEN_DISABLED");
  });

  it("org imageGenEnabled=true 면 정상 생성한다", async () => {
    const tool = createImageGenerateTool({
      port: createDevStubImageGenProvider(),
      da: fakeArtifactDa(),
      settings: {
        async resolve() {
          return { imageGenEnabled: true };
        },
      },
    });
    const result = await tool.invoke({
      toolCallId: "tc-4",
      args: { prompt: "a mountain" },
      ctx: fakeToolContext(),
    });
    expect(result.content.kind).toBe("json");
  });

  it("dev-stub 은 같은 prompt 에 결정론적 이미지(같은 바이트)를 반환한다", async () => {
    const port: ImageGenPort = createDevStubImageGenProvider();
    const [a] = await port.generate("same prompt");
    const [b] = await port.generate("same prompt");
    expect(a.mimeType).toBe("image/png");
    expect(Buffer.compare(a.data, b.data)).toBe(0);
    expect(a.data.byteLength).toBeGreaterThan(0);
  });
});

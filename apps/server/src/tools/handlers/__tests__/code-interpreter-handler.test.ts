import { describe, it, expect } from "vitest";
import type {
  ArtifactRecord,
  Chunk,
  SandboxTransport,
  ToolContext,
} from "@wchat/interfaces";
import { createCodeInterpreterTool } from "../code-interpreter-handler.js";
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

function fakeArtifactDa(): ArtifactDataAccess & { insertCalls: number } {
  const store = new Map<string, ArtifactRecord>();
  let seq = 0;
  const result = {
    insertCalls: 0,
    artifacts: {
      async insert(data: Record<string, unknown>) {
        result.insertCalls += 1;
        seq += 1;
        const record: ArtifactRecord = {
          id: `artifact-${seq}`,
          sessionId: (data.sessionId as string | null) ?? null,
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
      async byId(id: string) {
        return store.get(id) ?? null;
      },
      async list() {
        return { items: [...store.values()] };
      },
    },
  };
  return result;
}

interface FakeTransportOpts {
  chunks: Chunk[];
  outputs?: Map<string, Buffer>;
  onChunkConsumed?: (index: number) => void;
}

function fakeTransport(opts: FakeTransportOpts): SandboxTransport {
  const outputs = opts.outputs ?? new Map<string, Buffer>();
  return {
    async start(input, signal) {
      if (signal?.aborted) throw new Error("start aborted");
      return {
        id: "sandbox-1",
        startedAt: new Date(),
        templateId: input.templateId,
      };
    },
    async *runCommand(_handle, _cmd, _opts, _signal): AsyncIterable<Chunk> {
      for (let i = 0; i < opts.chunks.length; i++) {
        opts.onChunkConsumed?.(i);
        yield opts.chunks[i];
      }
    },
    async writeFile() {},
    async readFile(_handle, path) {
      const buf = outputs.get(path);
      if (!buf) throw new Error(`no such file: ${path}`);
      return buf;
    },
    async listDir(_handle, dir) {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      const out: { name: string; isDir: boolean; size: number }[] = [];
      for (const [path, buf] of outputs) {
        if (
          path.startsWith(prefix) &&
          !path.slice(prefix.length).includes("/")
        ) {
          out.push({
            name: path.slice(prefix.length),
            isDir: false,
            size: buf.byteLength,
          });
        }
      }
      if (out.length === 0 && outputs.size === 0) {
        throw new Error(`no such dir: ${dir}`);
      }
      return out;
    },
    async uploadToS3() {
      throw new Error("not implemented");
    },
    async stop() {},
  };
}

describe("createCodeInterpreterTool", () => {
  it("spec 은 code_interpreter 계약(allow policy + code-exec tag)을 만족한다", () => {
    const tool = createCodeInterpreterTool({
      transport: fakeTransport({ chunks: [] }),
      da: fakeArtifactDa(),
    });

    expect(tool.spec.name).toBe("code_interpreter");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toEqual(expect.arrayContaining(["code-exec"]));
  });

  it("생성 파일이 없으면 stdout 을 text 결과로 반환한다", async () => {
    const transport = fakeTransport({
      chunks: [
        { type: "stdout", data: "hello " },
        { type: "stdout", data: "world\n" },
        { type: "exit", code: 0, reason: "ok" },
      ],
    });
    const tool = createCodeInterpreterTool({ transport, da: fakeArtifactDa() });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { code: "print('hello world')" },
      ctx: fakeToolContext(),
    });

    expect(result.toolCallId).toBe("call-1");
    expect(result.content.kind).toBe("text");
    if (result.content.kind === "text") {
      expect(result.content.text).toBe("hello world\n");
    }
  });

  it("생성된 파일이 있으면 artifact 로 저장하고 json 결과의 artifact 필드로 반환한다", async () => {
    const da = fakeArtifactDa();
    const transport = fakeTransport({
      chunks: [
        { type: "stdout", data: "wrote plot.png\n" },
        { type: "exit", code: 0, reason: "ok" },
      ],
      outputs: new Map([
        ["/home/user/outputs/plot.png", Buffer.from("fake-png-bytes")],
      ]),
    });
    const tool = createCodeInterpreterTool({ transport, da });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { code: "plt.savefig('outputs/plot.png')" },
      ctx: fakeToolContext(),
    });

    expect(da.insertCalls).toBe(1);
    expect(result.content.kind).toBe("json");
    if (result.content.kind === "json") {
      const data = result.content.data as {
        stdout: string;
        artifact: {
          artifactId: string;
          artifactKind: string;
          filename: string;
          sizeBytes: number;
          downloadUrl: string;
        };
      };
      expect(data.stdout).toBe("wrote plot.png\n");
      expect(data.artifact.filename).toBe("plot.png");
      expect(data.artifact.artifactId).toBe("artifact-1");
      expect(data.artifact.sizeBytes).toBeGreaterThan(0);
      expect(data.artifact.downloadUrl).toContain("artifact-1");
    }
  });

  it("code 가 비어있으면 INVALID_INPUT 에러를 반환한다", async () => {
    const tool = createCodeInterpreterTool({
      transport: fakeTransport({ chunks: [] }),
      da: fakeArtifactDa(),
    });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { code: "   " },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("ctx.signal 이 실행 중간에 abort 되면 남은 stdout 을 무시하고 throw 하며 artifact 를 생성하지 않는다", async () => {
    const controller = new AbortController();
    const da = fakeArtifactDa();
    const transport = fakeTransport({
      chunks: [
        { type: "stdout", data: "partial\n" },
        { type: "stdout", data: "should-not-be-processed\n" },
        { type: "exit", code: 0, reason: "ok" },
      ],
      outputs: new Map([
        ["/home/user/outputs/plot.png", Buffer.from("fake-png-bytes")],
      ]),
      onChunkConsumed: (index) => {
        if (index === 0) controller.abort();
      },
    });
    const tool = createCodeInterpreterTool({ transport, da });

    await expect(
      tool.invoke({
        toolCallId: "call-4",
        args: { code: "print('partial')" },
        ctx: fakeToolContext({ signal: controller.signal }),
      }),
    ).rejects.toThrow();

    expect(da.insertCalls).toBe(0);
  });
});

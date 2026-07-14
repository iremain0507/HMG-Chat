import { describe, it, expect, vi } from "vitest";
import type { Chunk } from "@wchat/interfaces";
import { createInMemoryObjectStore } from "../../../lib/object-store.js";
import {
  createE2BSandboxTransport,
  type E2BSandboxLike,
} from "../sandbox-transport-e2b.js";

async function collect(iter: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

function fakeSandbox(
  overrides?: Partial<E2BSandboxLike>,
): E2BSandboxLike & { kill: ReturnType<typeof vi.fn> } {
  const files = new Map<string, Buffer>();
  const kill = vi.fn(async () => true);
  return {
    sandboxId: "e2b-sbx-1",
    commands: {
      run: vi.fn(async (_cmd, opts) => {
        opts.onStdout?.("hello\n");
        opts.onStderr?.("warn\n");
        return {
          wait: async () => ({ exitCode: 0 }),
          kill: async () => true,
        };
      }),
    },
    files: {
      write: vi.fn(async (path: string, data: string | Buffer) => {
        files.set(
          path,
          typeof data === "string"
            ? Buffer.from(data, "utf8")
            : (data as Buffer),
        );
      }),
      read: vi.fn(async (path: string) => {
        const buf = files.get(path);
        if (!buf) throw new Error(`not found: ${path}`);
        return new Uint8Array(buf);
      }),
      list: vi.fn(async () => [
        { name: "a.txt", type: "file", path: "/work/a.txt" },
        { name: "sub", type: "dir", path: "/work/sub" },
      ]),
    },
    kill,
    ...overrides,
  };
}

describe("createE2BSandboxTransport", () => {
  it("start 는 기본적으로 allowInternetAccess:false 로 sandbox 를 생성한다(egress 기본 차단)", async () => {
    const sandbox = fakeSandbox();
    const createSandbox = vi.fn(async () => sandbox);
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox,
    });

    await transport.start({ sessionId: "s1", templateId: "wchat-default-v1" });

    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        template: "wchat-default-v1",
        apiKey: "test-key",
        allowInternetAccess: false,
      }),
    );
  });

  it("allowInternetAccess 를 명시하면 그 값을 사용한다", async () => {
    const sandbox = fakeSandbox();
    const createSandbox = vi.fn(async () => sandbox);
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox,
      allowInternetAccess: true,
    });

    await transport.start({ sessionId: "s2", templateId: "wchat-default-v1" });

    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ allowInternetAccess: true }),
    );
  });

  it("runCommand 는 onStdout/onStderr 콜백을 Chunk 스트림으로 변환하고 exit chunk 로 끝난다", async () => {
    const sandbox = fakeSandbox();
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s3",
      templateId: "wchat-default-v1",
    });

    const chunks = await collect(
      transport.runCommand(
        handle,
        "echo hello",
        {},
        new AbortController().signal,
      ),
    );

    expect(chunks).toEqual([
      { type: "stdout", data: "hello\n" },
      { type: "stderr", data: "warn\n" },
      { type: "exit", code: 0, reason: "ok" },
    ]);
  });

  it("signal 이 abort 되면 command 를 kill 하고 exit reason=killed 를 방출한다", async () => {
    let killed = false;
    const commandKill = vi.fn(async () => {
      killed = true;
      return true;
    });
    const sandbox = fakeSandbox({
      commands: {
        run: vi.fn(async (_cmd, _opts) => {
          return {
            wait: () =>
              new Promise<{ exitCode: number }>((resolve) => {
                const check = setInterval(() => {
                  if (killed) {
                    clearInterval(check);
                    resolve({ exitCode: 137 });
                  }
                }, 5);
              }),
            kill: commandKill,
          };
        }),
      },
    });
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s4",
      templateId: "wchat-default-v1",
    });
    const controller = new AbortController();

    const runPromise = collect(
      transport.runCommand(handle, "sleep 30", {}, controller.signal),
    );
    controller.abort();
    const chunks = await runPromise;

    expect(commandKill).toHaveBeenCalled();
    expect(chunks[chunks.length - 1]).toEqual({
      type: "exit",
      code: 137,
      reason: "killed",
    });
  });

  it("writeFile/readFile 은 sandbox.files.write/read 에 위임한다", async () => {
    const sandbox = fakeSandbox();
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s5",
      templateId: "wchat-default-v1",
    });

    await transport.writeFile(handle, "/tmp/a.txt", "hi");
    expect(sandbox.files.write).toHaveBeenCalledWith("/tmp/a.txt", "hi");

    const buf = await transport.readFile(handle, "/tmp/a.txt");
    expect(buf.toString("utf8")).toBe("hi");
  });

  it("listDir 는 sandbox.files.list 결과를 {name,isDir,size} 로 정규화한다", async () => {
    const sandbox = fakeSandbox();
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s6",
      templateId: "wchat-default-v1",
    });

    const entries = await transport.listDir(handle, "/work");

    expect(entries).toEqual([
      { name: "a.txt", isDir: false, size: 0 },
      { name: "sub", isDir: true, size: 0 },
    ]);
  });

  it("uploadToS3 는 sandbox 파일을 읽어 objectStore 에 저장한다", async () => {
    const sandbox = fakeSandbox();
    const objectStore = createInMemoryObjectStore();
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore,
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s7",
      templateId: "wchat-default-v1",
    });
    await transport.writeFile(handle, "/out/r.txt", "report");

    await transport.uploadToS3(handle, "/out/r.txt", "artifacts/r.txt");

    const stored = await objectStore.get("artifacts/r.txt");
    expect(stored.toString("utf8")).toBe("report");
  });

  it("stop 은 sandbox.kill 을 호출한다", async () => {
    const sandbox = fakeSandbox();
    const transport = createE2BSandboxTransport({
      apiKey: "test-key",
      objectStore: createInMemoryObjectStore(),
      createSandbox: async () => sandbox,
    });
    const handle = await transport.start({
      sessionId: "s8",
      templateId: "wchat-default-v1",
    });

    await transport.stop(handle);

    expect(sandbox.kill).toHaveBeenCalled();
  });
});

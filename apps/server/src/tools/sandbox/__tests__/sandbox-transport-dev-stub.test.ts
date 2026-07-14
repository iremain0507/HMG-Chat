import { describe, it, expect } from "vitest";
import type { Chunk } from "@wchat/interfaces";
import { createInMemoryObjectStore } from "../../../lib/object-store.js";
import { createDevStubSandboxTransport } from "../sandbox-transport-dev-stub.js";

async function collect(iter: AsyncIterable<Chunk>): Promise<Chunk[]> {
  const out: Chunk[] = [];
  for await (const chunk of iter) out.push(chunk);
  return out;
}

describe("createDevStubSandboxTransport", () => {
  it("start 는 SandboxHandle 을 반환한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s1",
      templateId: "wchat-default-v1",
    });
    expect(handle.templateId).toBe("wchat-default-v1");
    expect(handle.id).toBeTruthy();
    expect(handle.startedAt).toBeInstanceOf(Date);
  });

  it("동일 sessionId 재호출은 같은 handle 을 반환한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const h1 = await transport.start({
      sessionId: "same",
      templateId: "wchat-default-v1",
    });
    const h2 = await transport.start({
      sessionId: "same",
      templateId: "wchat-default-v1",
    });
    expect(h2.id).toBe(h1.id);
  });

  it("등록된 fixture 커맨드는 지정된 chunk 스트림을 그대로 방출한다", async () => {
    const fixtures = new Map<string, Chunk[]>([
      [
        "echo hi",
        [
          { type: "stdout", data: "hi\n" },
          { type: "exit", code: 0, reason: "ok" },
        ],
      ],
    ]);
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
      fixtures,
    });
    const handle = await transport.start({
      sessionId: "s2",
      templateId: "wchat-default-v1",
    });
    const chunks = await collect(
      transport.runCommand(handle, "echo hi", {}, new AbortController().signal),
    );
    expect(chunks).toEqual([
      { type: "stdout", data: "hi\n" },
      { type: "exit", code: 0, reason: "ok" },
    ]);
  });

  it("미등록 커맨드는 결정론적 synthetic stdout + exit 0 을 방출한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s3",
      templateId: "wchat-default-v1",
    });
    const chunks = await collect(
      transport.runCommand(handle, "ls -la", {}, new AbortController().signal),
    );
    expect(chunks[chunks.length - 1]).toEqual({
      type: "exit",
      code: 0,
      reason: "ok",
    });
    expect(
      chunks.some((c) => c.type === "stdout" && c.data.includes("ls -la")),
    ).toBe(true);
  });

  it("네트워크 egress 시도 커맨드는 기본적으로 차단되어 stderr + exit non-zero 를 방출한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s4",
      templateId: "wchat-default-v1",
    });
    const chunks = await collect(
      transport.runCommand(
        handle,
        "curl https://example.com",
        {},
        new AbortController().signal,
      ),
    );
    const last = chunks[chunks.length - 1];
    expect(last?.type).toBe("exit");
    expect(last && last.type === "exit" ? last.code : 0).not.toBe(0);
    expect(chunks.some((c) => c.type === "stderr")).toBe(true);
  });

  it("signal 이 abort 되면 스트림은 exit reason=killed 로 조기 종료한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s5",
      templateId: "wchat-default-v1",
    });
    const controller = new AbortController();
    controller.abort();
    const chunks = await collect(
      transport.runCommand(handle, "sleep 30", {}, controller.signal),
    );
    expect(chunks).toEqual([{ type: "exit", code: 137, reason: "killed" }]);
  });

  it("writeFile 후 readFile 로 동일 바이트를 읽는다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s6",
      templateId: "wchat-default-v1",
    });
    await transport.writeFile(handle, "/tmp/a.txt", "hello");
    const buf = await transport.readFile(handle, "/tmp/a.txt");
    expect(buf.toString("utf8")).toBe("hello");
  });

  it("listDir 는 작성된 파일들을 나열한다", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const handle = await transport.start({
      sessionId: "s7",
      templateId: "wchat-default-v1",
    });
    await transport.writeFile(handle, "/work/a.txt", "aa");
    await transport.writeFile(handle, "/work/b.txt", "bbb");
    const entries = await transport.listDir(handle, "/work");
    expect(entries).toEqual(
      expect.arrayContaining([
        { name: "a.txt", isDir: false, size: 2 },
        { name: "b.txt", isDir: false, size: 3 },
      ]),
    );
  });

  it("uploadToS3 는 sandbox 파일을 objectStore 에 저장한다", async () => {
    const objectStore = createInMemoryObjectStore();
    const transport = createDevStubSandboxTransport({ objectStore });
    const handle = await transport.start({
      sessionId: "s8",
      templateId: "wchat-default-v1",
    });
    await transport.writeFile(handle, "/out/report.txt", "report body");
    await transport.uploadToS3(
      handle,
      "/out/report.txt",
      "artifacts/report.txt",
    );
    const stored = await objectStore.get("artifacts/report.txt");
    expect(stored.toString("utf8")).toBe("report body");
  });

  it("stop 이후 handle 은 stopped 로 표시된다(재시작 시 새 handle)", async () => {
    const transport = createDevStubSandboxTransport({
      objectStore: createInMemoryObjectStore(),
    });
    const h1 = await transport.start({
      sessionId: "s9",
      templateId: "wchat-default-v1",
    });
    await transport.stop(h1, "manual");
    const h2 = await transport.start({
      sessionId: "s9",
      templateId: "wchat-default-v1",
    });
    expect(h2.id).not.toBe(h1.id);
  });
});

// sandbox-transport-e2b.ts — E2B(Firecracker) 기반 SandboxTransport 실 구현.
//   packages/interfaces/src/SandboxTransport.ts(§2, 동결 계약) 구현. 실 "e2b" SDK 는
//   sandboxFactory 로 주입(기본값 = 실 e2b.Sandbox.create) — 테스트는 fake factory 주입
//   (web-search-provider-tavily.ts 의 fetchImpl DI 와 동일 패턴), LOCAL_ONLY 세션은 실
//   E2B_API_KEY 가 없어 이 어댑터는 배포 시에만 실사용(현재는 sandbox-transport-dev-stub.ts
//   가 app.ts 조립에 사용됨).
//   egress 는 allowInternetAccess 기본값 false 로 차단(§20.4 lethal-trifecta 방어).
import type { Chunk, SandboxHandle, SandboxTransport } from "@wchat/interfaces";
import type { ObjectStore } from "../../lib/object-store.js";

export interface E2BCommandHandle {
  wait(): Promise<{ exitCode: number }>;
  kill(): Promise<boolean>;
}

export interface E2BCommandRunOpts {
  background: true;
  cwd?: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export interface E2BEntryInfo {
  name: string;
  path: string;
  type?: string;
  size?: number;
}

export interface E2BSandboxLike {
  sandboxId: string;
  commands: {
    run(cmd: string, opts: E2BCommandRunOpts): Promise<E2BCommandHandle>;
  };
  files: {
    write(path: string, data: string | Buffer): Promise<unknown>;
    read(path: string, opts?: { format?: "bytes" }): Promise<Uint8Array>;
    list(path: string): Promise<E2BEntryInfo[]>;
  };
  kill(): Promise<boolean>;
}

export interface E2BCreateSandboxOpts {
  template: string;
  apiKey: string;
  envs?: Record<string, string>;
  timeoutMs?: number;
  allowInternetAccess: boolean;
}

export interface CreateE2BSandboxTransportDeps {
  apiKey: string;
  objectStore: ObjectStore;
  /** @default false — egress 기본 차단 */
  allowInternetAccess?: boolean;
  /** 실 e2b.Sandbox.create 를 감싼 factory. 미지정 시 실 "e2b" SDK 로 lazy-import. */
  createSandbox?: (opts: E2BCreateSandboxOpts) => Promise<E2BSandboxLike>;
}

async function defaultCreateSandbox(
  opts: E2BCreateSandboxOpts,
): Promise<E2BSandboxLike> {
  const { Sandbox } = await import("e2b");
  const sandbox = await Sandbox.create(opts.template, {
    apiKey: opts.apiKey,
    allowInternetAccess: opts.allowInternetAccess,
    ...(opts.envs ? { envs: opts.envs } : {}),
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return sandbox as unknown as E2BSandboxLike;
}

interface LiveSandbox {
  handle: SandboxHandle;
  sandbox: E2BSandboxLike;
}

export function createE2BSandboxTransport(
  deps: CreateE2BSandboxTransportDeps,
): SandboxTransport {
  const bySession = new Map<string, LiveSandbox>();
  const createSandbox = deps.createSandbox ?? defaultCreateSandbox;

  function findLive(handle: SandboxHandle): LiveSandbox {
    for (const live of bySession.values()) {
      if (live.handle.id === handle.id) return live;
    }
    throw new Error(`e2b sandbox: handle 없음 '${handle.id}'`);
  }

  return {
    async start(input, signal) {
      if (signal?.aborted) throw new Error("sandbox start aborted");
      const existing = bySession.get(input.sessionId);
      if (existing) return existing.handle;

      const sandbox = await createSandbox({
        template: input.templateId,
        apiKey: deps.apiKey,
        allowInternetAccess: deps.allowInternetAccess ?? false,
        ...(input.envVars ? { envs: input.envVars } : {}),
        ...(input.timeoutMs !== undefined
          ? { timeoutMs: input.timeoutMs }
          : {}),
      });

      const handle: SandboxHandle = {
        id: sandbox.sandboxId,
        startedAt: new Date(),
        templateId: input.templateId,
      };
      bySession.set(input.sessionId, { handle, sandbox });
      return handle;
    },

    async *runCommand(handle, cmd, opts, signal): AsyncIterable<Chunk> {
      const { sandbox } = findLive(handle);

      const queue: Chunk[] = [];
      let resolveNext: (() => void) | undefined;
      let done = false;

      function push(chunk: Chunk): void {
        queue.push(chunk);
        resolveNext?.();
      }

      const runHandlePromise = sandbox.commands.run(cmd, {
        background: true,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.envVars ? { envs: opts.envVars } : {}),
        ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
        onStdout: (data) => push({ type: "stdout", data }),
        onStderr: (data) => push({ type: "stderr", data }),
      });

      let onAbort: (() => void) | undefined;
      const abortPromise = new Promise<void>((resolve) => {
        onAbort = () => resolve();
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", onAbort, { once: true });
      });

      void (async () => {
        const cmdHandle = await runHandlePromise;
        const outcome = await Promise.race([
          cmdHandle
            .wait()
            .then((r) => ({ kind: "done" as const, exitCode: r.exitCode })),
          abortPromise.then(() => ({ kind: "aborted" as const })),
        ]);
        if (outcome.kind === "aborted") {
          await cmdHandle.kill();
          push({ type: "exit", code: 137, reason: "killed" });
        } else {
          push({ type: "exit", code: outcome.exitCode, reason: "ok" });
        }
        done = true;
        resolveNext?.();
      })();

      try {
        while (true) {
          while (queue.length > 0) {
            const chunk = queue.shift()!;
            yield chunk;
            if (chunk.type === "exit") return;
          }
          if (done) return;
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    },

    async writeFile(handle, path, content) {
      const { sandbox } = findLive(handle);
      await sandbox.files.write(path, content);
    },

    async readFile(handle, path) {
      const { sandbox } = findLive(handle);
      const bytes = await sandbox.files.read(path, { format: "bytes" });
      return Buffer.from(bytes);
    },

    async listDir(handle, path) {
      const { sandbox } = findLive(handle);
      const entries = await sandbox.files.list(path);
      return entries.map((e) => ({
        name: e.name,
        isDir: e.type === "dir",
        size: e.size ?? 0,
      }));
    },

    async uploadToS3(handle, srcPath, s3Key) {
      const { sandbox } = findLive(handle);
      const bytes = await sandbox.files.read(srcPath, { format: "bytes" });
      await deps.objectStore.put(s3Key, Buffer.from(bytes));
    },

    async stop(handle) {
      const { sandbox } = findLive(handle);
      await sandbox.kill();
    },
  };
}

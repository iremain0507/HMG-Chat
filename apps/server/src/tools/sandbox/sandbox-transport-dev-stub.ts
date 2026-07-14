// sandbox-transport-dev-stub.ts — 로컬 dev/테스트용 in-memory SandboxTransport.
//   packages/interfaces/src/SandboxTransport.ts(§2, 동결 계약) 구현. LOCAL_ONLY 환경엔
//   실 E2B 계정/네트워크가 없으므로, 파일시스템·프로세스 실행을 in-memory 로 시뮬레이션한다.
//   실 provider(sandbox-transport-e2b.ts) 는 배포 시 교체 — web-search-provider-dev-stub.ts 와
//   동일한 "결정론적 fallback + fixture 주입" 패턴.
import type { Chunk, SandboxHandle, SandboxTransport } from "@wchat/interfaces";
import type { ObjectStore } from "../../lib/object-store.js";

export interface CreateDevStubSandboxTransportDeps {
  objectStore: ObjectStore;
  /** cmd 문자열 → 방출할 Chunk 시퀀스. 미등록 cmd 는 synthetic 결과로 폴백. */
  fixtures?: Map<string, Chunk[]>;
}

// egress 기본-차단 시뮬레이션 — curl/wget/nc/http(s) 스킴을 포함하는 커맨드는
// 네트워크 접근 시도로 간주해 차단(§20.4 lethal-trifecta 방어, "egress 기본 차단").
const EGRESS_ATTEMPT_RE = /\b(curl|wget|nc)\b|https?:\/\//i;

function isNetworkEgressAttempt(cmd: string): boolean {
  return EGRESS_ATTEMPT_RE.test(cmd);
}

interface StubSandbox {
  handle: SandboxHandle;
  files: Map<string, Buffer>;
  stopped: boolean;
}

export function createDevStubSandboxTransport(
  deps: CreateDevStubSandboxTransportDeps,
): SandboxTransport {
  const bySession = new Map<string, StubSandbox>();
  let nextId = 1;

  function dirOf(path: string): string {
    const idx = path.lastIndexOf("/");
    return idx <= 0 ? "/" : path.slice(0, idx);
  }

  return {
    async start(input, signal) {
      if (signal?.aborted) throw new Error("sandbox start aborted");
      const existing = bySession.get(input.sessionId);
      if (existing && !existing.stopped) return existing.handle;

      const handle: SandboxHandle = {
        id: `dev-stub-sandbox-${nextId++}`,
        startedAt: new Date(),
        templateId: input.templateId,
      };
      bySession.set(input.sessionId, {
        handle,
        files: new Map(),
        stopped: false,
      });
      return handle;
    },

    async *runCommand(_handle, cmd, _opts, signal): AsyncIterable<Chunk> {
      if (signal.aborted) {
        yield { type: "exit", code: 137, reason: "killed" };
        return;
      }

      if (isNetworkEgressAttempt(cmd)) {
        yield {
          type: "stderr",
          data: "egress blocked: dev-stub default-deny network policy",
        };
        yield { type: "exit", code: 1, reason: "ok" };
        return;
      }

      const fixed = deps.fixtures?.get(cmd);
      if (fixed) {
        for (const chunk of fixed) {
          if (signal.aborted) {
            yield { type: "exit", code: 137, reason: "killed" };
            return;
          }
          yield chunk;
        }
        return;
      }

      yield { type: "stdout", data: `dev-stub stdout for: ${cmd}\n` };
      yield { type: "exit", code: 0, reason: "ok" };
    },

    async writeFile(handle, path, content) {
      const stub = findStub(bySession, handle);
      stub.files.set(
        path,
        typeof content === "string" ? Buffer.from(content, "utf8") : content,
      );
    },

    async readFile(handle, path) {
      const stub = findStub(bySession, handle);
      const buf = stub.files.get(path);
      if (!buf) throw new Error(`dev-stub sandbox: 파일 없음 '${path}'`);
      return buf;
    },

    async listDir(handle, path) {
      const stub = findStub(bySession, handle);
      const prefix = path.endsWith("/") ? path : `${path}/`;
      const out: { name: string; isDir: boolean; size: number }[] = [];
      for (const [filePath, buf] of stub.files) {
        if (dirOf(filePath) === path || filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length);
          if (rest.includes("/")) continue;
          out.push({ name: rest, isDir: false, size: buf.byteLength });
        }
      }
      return out;
    },

    async uploadToS3(handle, srcPath, s3Key) {
      const stub = findStub(bySession, handle);
      const buf = stub.files.get(srcPath);
      if (!buf) throw new Error(`dev-stub sandbox: 파일 없음 '${srcPath}'`);
      await deps.objectStore.put(s3Key, buf);
    },

    async stop(handle) {
      for (const stub of bySession.values()) {
        if (stub.handle.id === handle.id) stub.stopped = true;
      }
    },
  };
}

function findStub(
  bySession: Map<string, StubSandbox>,
  handle: SandboxHandle,
): StubSandbox {
  for (const stub of bySession.values()) {
    if (stub.handle.id === handle.id) return stub;
  }
  throw new Error(`dev-stub sandbox: handle 없음 '${handle.id}'`);
}

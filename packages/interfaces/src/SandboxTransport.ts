// packages/interfaces/src/SandboxTransport.ts
// § 2 — E2B (또는 mock) 와의 통신 추상화. orchestrator 직접 의존 안 함,
// bash 같은 handler 가 의존 (L11). 본 파일은 types.ts/errors.ts 를 import 하지 않음
// (자기-완결 타입만 사용).

export interface SandboxHandle {
  id: string;
  startedAt: Date;
  templateId: string;
}

export type Chunk =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number; reason?: "ok" | "timeout" | "killed" };

export interface SandboxTransport {
  start(
    input: {
      sessionId: string;
      templateId: string; // 'wchat-default-v1' 등
      envVars?: Record<string, string>;
      timeoutMs?: number; // default 15 * 60_000
    },
    signal?: AbortSignal,
  ): Promise<SandboxHandle>;

  // 명령 실행 — stdout/stderr 를 chunk 로 stream
  runCommand(
    handle: SandboxHandle,
    cmd: string,
    opts: { cwd?: string; envVars?: Record<string, string>; timeoutMs?: number },
    signal: AbortSignal,
  ): AsyncIterable<Chunk>;

  writeFile(
    handle: SandboxHandle,
    path: string,
    content: Buffer | string,
  ): Promise<void>;
  readFile(handle: SandboxHandle, path: string): Promise<Buffer>;
  listDir(
    handle: SandboxHandle,
    path: string,
  ): Promise<{ name: string; isDir: boolean; size: number }[]>;
  uploadToS3(
    handle: SandboxHandle,
    srcPath: string,
    s3Key: string,
  ): Promise<void>;

  stop(
    handle: SandboxHandle,
    reason?: "idle" | "manual" | "error",
  ): Promise<void>;

  warmUp?(templateId: string, count: number): Promise<void>;
}

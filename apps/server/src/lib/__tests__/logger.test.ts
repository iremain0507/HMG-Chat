import { describe, it, expect } from "vitest";
import { Writable } from "node:stream";
import { createLogger } from "../logger.js";

function captureStream() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { stream, lines };
}

function parsed(lines: string[]) {
  return lines
    .join("")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("createLogger", () => {
  it("info()는 category/level/msg 를 포함한 구조화 JSON 한 줄을 출력한다", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ destination: stream });

    logger.info({
      category: "tool",
      msg: "knowledge search ok",
      requestId: "req-1",
      userId: "user-1",
      orgId: "org-1",
      durationMs: 234,
    });

    const [entry] = parsed(lines);
    expect(entry.level).toBe("info");
    expect(entry.category).toBe("tool");
    expect(entry.msg).toBe("knowledge search ok");
    expect(entry.requestId).toBe("req-1");
    expect(entry.userId).toBe("user-1");
    expect(entry.orgId).toBe("org-1");
    expect(entry.durationMs).toBe(234);
  });

  it("error()는 error 필드를 err 로 직렬화해 stack 을 보존한다", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ destination: stream });

    logger.error({
      category: "db",
      msg: "query failed",
      error: new Error("connection refused"),
    });

    const [entry] = parsed(lines);
    expect(entry.level).toBe("error");
    expect(entry.category).toBe("db");
    expect(entry.err).toBeDefined();
    expect(entry.err.message).toBe("connection refused");
    expect(typeof entry.err.stack).toBe("string");
  });

  it("child()는 requestId/userId/orgId 를 이후 모든 로그에 자동 바인딩한다", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ destination: stream });
    const child = logger.child({ requestId: "req-2", userId: "user-2" });

    child.warn({ category: "auth", msg: "token expiring soon" });

    const [entry] = parsed(lines);
    expect(entry.requestId).toBe("req-2");
    expect(entry.userId).toBe("user-2");
    expect(entry.category).toBe("auth");
    expect(entry.level).toBe("warn");
  });

  it("level 옵션 아래의 레벨은 출력을 억제한다 (info 기본값에서 debug 무시)", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ destination: stream });

    logger.debug({ category: "system", msg: "verbose detail" });

    expect(parsed(lines)).toHaveLength(0);
  });

  it("context 는 임의 추가 필드를 구조화된 형태로 보존한다", () => {
    const { stream, lines } = captureStream();
    const logger = createLogger({ destination: stream });

    logger.info({
      category: "mcp",
      msg: "tool call",
      context: { tool: "web_fetch", statusCode: 200 },
    });

    const [entry] = parsed(lines);
    expect(entry.context).toEqual({ tool: "web_fetch", statusCode: 200 });
  });
});

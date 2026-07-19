// notifications.test.ts — P22-T2-02 acceptance: GET /notifications SSE 스트림이
// (1) 200 + content-type text/event-stream 로 열리고 즉시 heartbeat(ping) 를 방출,
// (2) 구독 사용자의 document_indexed 이벤트를 event:document_indexed + data(no-envelope)로 relay,
// (3) 다른 사용자의 이벤트는 받지 않음(cross-user 격리).
// 실 DB 불필요: 가짜 auth 미들웨어로 c.set("auth") 를 주입하고 실 route + 실 bus 를 엮어 검증.
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import type { AccessTokenPayload } from "../../middleware/jwt.js";
import type { AuthedVariables } from "../../middleware/auth-middleware.js";
import { publishNotification } from "../../orchestrator/notification-registry.js";
import { createNotificationRoutes } from "../notifications.js";

function authOf(sub: string): AccessTokenPayload {
  return {
    iss: "test",
    sub,
    org: "org-1",
    role: "member",
    scope: "access",
    iat: 0,
    exp: 0,
    jti: "jti",
  };
}

function appFor(userId: string) {
  const app = new Hono<{ Variables: AuthedVariables }>();
  app.use("*", async (c, next) => {
    c.set("auth", authOf(userId));
    await next();
  });
  app.route("/", createNotificationRoutes());
  return app;
}

// SSE 프레임을 하나 읽는다(타임아웃 시 null). 스트림은 스스로 닫히지 않으므로 abort 로 정리.
async function readFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 400,
): Promise<string | null> {
  const decoder = new TextDecoder();
  const timer = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), timeoutMs),
  );
  const next = reader
    .read()
    .then((r) => (r.done ? null : decoder.decode(r.value)));
  return Promise.race([next, timer]);
}

describe("GET /notifications SSE (P22-T2-02)", () => {
  const controllers: AbortController[] = [];

  afterEach(() => {
    for (const c of controllers.splice(0)) c.abort();
  });

  function open(userId: string) {
    const app = appFor(userId);
    const controller = new AbortController();
    controllers.push(controller);
    return app
      .request("/", {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      })
      .then((res) => ({ res, controller }));
  }

  it("200 + text/event-stream 헤더로 열리고 즉시 heartbeat ping 을 보낸다", async () => {
    const { res } = await open("user-hb");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const frame = await readFrame(reader);
    expect(frame).toContain("event: ping");
  });

  it("구독 사용자의 document_indexed 를 no-envelope data 로 relay 한다", async () => {
    const { res } = await open("user-doc");
    const reader = res.body!.getReader();
    // 초기 ping 을 소비해 구독이 활성화됐음을 보장한 뒤 publish.
    await readFrame(reader);
    publishNotification("user-doc", {
      type: "document_indexed",
      documentId: "doc-42",
      projectId: "proj-9",
      indexStatus: "indexed",
    });
    let acc = "";
    for (let i = 0; i < 3 && !acc.includes("document_indexed"); i++) {
      const f = await readFrame(reader);
      if (f) acc += f;
    }
    expect(acc).toContain("event: document_indexed");
    const dataLine = acc
      .split("\n")
      .find((l) => l.startsWith("data:"))!
      .slice("data:".length)
      .trim();
    const payload = JSON.parse(dataLine);
    expect(payload).toMatchObject({
      documentId: "doc-42",
      projectId: "proj-9",
      indexStatus: "indexed",
    });
    // 봉투(data/meta) 없이 union 필드 그대로여야 한다.
    expect(payload.data).toBeUndefined();
    expect(payload.meta).toBeUndefined();
  });

  it("다른 사용자의 이벤트는 받지 않는다 (cross-user 격리)", async () => {
    const a = await open("iso-A");
    const b = await open("iso-B");
    const readerA = a.res.body!.getReader();
    const readerB = b.res.body!.getReader();
    await readFrame(readerA); // 초기 ping 소비
    await readFrame(readerB);
    publishNotification("iso-A", {
      type: "document_indexed",
      documentId: "d",
      projectId: "p",
      indexStatus: "indexed",
    });
    // A 는 document_indexed 를 받는다.
    let accA = "";
    for (let i = 0; i < 3 && !accA.includes("document_indexed"); i++) {
      const f = await readFrame(readerA);
      if (f) accA += f;
    }
    expect(accA).toContain("document_indexed");
    // B 는 (heartbeat 이전) 추가 프레임이 없어 타임아웃(null)이어야 한다.
    const frameB = await readFrame(readerB, 300);
    expect(frameB).toBeNull();
  });
});

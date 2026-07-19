// routes/notifications.ts — 16-API-CONTRACT.md § GET /notifications (SSE) 단일 출처.
// authMiddleware 뒤에 마운트되며(app.ts), 인증된 사용자의 push 채널을 연다. 서버측 소스
// (문서 인덱싱 완료 등)가 orchestrator/notification-registry.publishNotification(userId, event)
// 를 호출하면 여기서 event:<type> + data:JSON.stringify(event) 로 relay 한다(REST 봉투 없음 — 계약 906).
// 30초 heartbeat(event:ping)로 ALB/프록시 idle timeout 을 넘긴다(routes/messages.ts:574 패턴 재사용).
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { NotificationEvent } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import { subscribeNotifications } from "../orchestrator/notification-registry.js";

const HEARTBEAT_MS = 30_000;

export function createNotificationRoutes(): Hono<{
  Variables: AuthedVariables;
}> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.get("/", (c) => {
    const userId = c.get("auth").sub;
    // 리버스 프록시가 SSE 를 버퍼링하지 않게(즉시 전달). messages.ts SSE 와 동일.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const subscription = subscribeNotifications(userId);
      const writePing = () =>
        stream
          .writeSSE({ event: "ping", data: JSON.stringify({ type: "ping" }) })
          .catch(() => {});
      // 연결 즉시 ping 을 한 번 보내 스트림 오픈을 확정(클라이언트 onopen 트리거)한다.
      await writePing();
      const heartbeat = setInterval(() => void writePing(), HEARTBEAT_MS);
      // 클라이언트 연결 종료(abort) 시 구독 해제 → for-await 루프 종료 → stream close.
      const signal = c.req.raw.signal;
      const onAbort = () => subscription.unsubscribe();
      if (signal.aborted) {
        subscription.unsubscribe();
      } else {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        for await (const event of subscription.events as AsyncIterable<NotificationEvent>) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } finally {
        clearInterval(heartbeat);
        signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();
      }
    });
  });

  return app;
}

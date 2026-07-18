import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { pgPool } from "./db/client.js";
import { createPgAlertEventDataAccess } from "./db/alert-event-data-access.js";
import { createPgHealthHistoryDataAccess } from "./db/health-history-data-access.js";
import { loadEnv } from "./env.js";
import { createAlertNotifier } from "./lib/alert-engine.js";
import { startAlertingScheduler } from "./lib/alerting-scheduler.js";
import { createLogger } from "./lib/logger.js";

const env = loadEnv();
const app = createApp(env);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.warn(`[server] listening on http://localhost:${info.port}`);
});

// 12-OPS-SECURITY.md § Alarms — 주기 health rule 평가 루프를 부트스트랩에서 배선한다.
//   probe 는 실제 의존성만(현재 스택은 Redis 가 dev in-memory 라 DB probe 만 실제). 스택 확장 시
//   redis/e2b/llm probe 를 여기에 추가하면 스케줄러가 그대로 평가·알림한다. ALERTING_ENABLED=false 로
//   opt-out 가능(테스트/로컬).
const logger = createLogger();
const alertingHandle =
  process.env.ALERTING_ENABLED === "false"
    ? null
    : startAlertingScheduler({
        healthHistory: createPgHealthHistoryDataAccess().healthHistory,
        alertEvents: createPgAlertEventDataAccess().alertEvents,
        notifier: createAlertNotifier(),
        probes: {
          db: async () => {
            await pgPool.query("SELECT 1");
          },
        },
        // Logger(typed payload) 를 스케줄러의 (message, meta) 시그니처로 어댑트.
        logger: {
          error(message, meta) {
            logger.error({
              category: "system",
              msg: message,
              ...(meta ? { context: meta } : {}),
            });
          },
        },
      });

// clean shutdown — 등록한 타이머를 반드시 해제(누수 방지) 후 서버 종료.
function shutdown(signal: string): void {
  console.warn(`[server] ${signal} received, shutting down`);
  alertingHandle?.stop();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

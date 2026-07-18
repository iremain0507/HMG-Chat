import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { pgPool } from "./db/client.js";
import { createPgAlertEventDataAccess } from "./db/alert-event-data-access.js";
import { createPgArtifactDataAccess } from "./db/artifact-data-access.js";
import { createPgArtifactShareDataAccess } from "./db/artifact-share-data-access.js";
import { createPgAuditLogDataAccess } from "./db/audit-log-data-access.js";
import { createPgAuthDataAccess } from "./db/auth-data-access.js";
import { createPgErrorLogDataAccess } from "./db/error-log-data-access.js";
import { createPgMessageDataAccess } from "./db/message-data-access.js";
import { createPgHealthHistoryDataAccess } from "./db/health-history-data-access.js";
import { createPgUploadDataAccess } from "./db/upload-data-access.js";
import { loadEnv } from "./env.js";
import { createAlertNotifier } from "./lib/alert-engine.js";
import { startAlertingScheduler } from "./lib/alerting-scheduler.js";
import { createInlineArtifactStore } from "./lib/artifact-store.inline.js";
import { createAuditRecorder } from "./lib/audit-recorder.js";
import { createLogger } from "./lib/logger.js";
import { activateRuntimeBusFromEnv } from "./orchestrator/runtime-bus.js";
import { startRetentionScheduler } from "./lib/retention-scheduler.js";

const env = loadEnv();

// P22-T2-03 — abort/resume/HITL 런타임 상태 백엔드를 배포 시점에 선택한다.
//   RUNTIME_STATE_BACKEND=memory(기본): 기존 LOCAL_ONLY 단일 프로세스 동작 그대로.
//   RUNTIME_STATE_BACKEND=redis: REDIS_URL 을 실제로 소비해, 다중 인스턴스에서 Stop(abort)·
//   SSE resume 캐치업·HITL 승인이 소유 인스턴스로 팬아웃된다. createApp 이전에 활성화해야
//   registry 모듈 기본 인스턴스가 올바른 bus 에 바인딩된다.
const runtimeBusHandle = await activateRuntimeBusFromEnv(env);
console.warn(`[server] runtime state backend: ${runtimeBusHandle.backend}`);

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

// 12-OPS-SECURITY.md § 부록 H — 데이터 retention job(만료 uploads/artifact-share/store 정리)을
//   매일 03:00 KST 부근에 실행하도록 부트스트랩에서 배선한다. RETENTION_ENABLED=false 로 opt-out
//   가능(테스트/로컬). 실 upload/artifactShare DataAccess·artifact store·alert engine 을 주입한다.
const retentionHandle =
  process.env.RETENTION_ENABLED === "false"
    ? null
    : startRetentionScheduler({
        da: {
          uploads: createPgUploadDataAccess().uploads,
          artifactShares: createPgArtifactShareDataAccess().artifactShares,
          // 부록 H 3·4·5 (P22-T1-15 / 계약배치 C2)
          errorLogs: createPgErrorLogDataAccess().errorLogs,
          healthHistory: createPgHealthHistoryDataAccess().healthHistory,
          messages: createPgMessageDataAccess(),
          organizations: createPgAuthDataAccess().organizations,
        },
        // 부록 H 3번 메시지 삭제는 org 단위 파괴적 작업이라 audit_log 에 남긴다(fail-soft).
        audit: createAuditRecorder(createPgAuditLogDataAccess(), logger),
        artifactStore: createInlineArtifactStore(
          createPgArtifactDataAccess().artifacts,
        ),
        alerting: {
          repo: createPgAlertEventDataAccess().alertEvents,
          notifier: createAlertNotifier(),
        },
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
  retentionHandle?.stop();
  void runtimeBusHandle.stop();
  server.close();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

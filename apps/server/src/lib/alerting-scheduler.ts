// alerting-scheduler.ts — 12-OPS-SECURITY.md § Alarms.
//   alert-engine(triggerAlert)/health-checker(runHealthChecks) 는 "1회 실행" 함수만 제공하고
//   주기 실행(rule-evaluation loop)·부트스트랩 배선은 서버 몫이라고 각 파일 헤더가 명시한다.
//   여기서 그 주기 스케줄러를 제공한다: 매 tick 마다 주입된 probe 로 health check 를 돌리고
//   unhealthy(=degraded|down) 대상이 나오면 triggerAlert 로 AlertEvent 를 영속화 + notifier 발송.
//   node-cron 등 신규 의존성을 쓰지 않고 setInterval(주입 가능)로 구현 — 테스트는 fake timer +
//   runTick() 직접 호출로 결정적으로 검증하고, 실 부트스트랩(index.ts)만 실 타이머를 등록한다.
import type { AlertEventRepo, HealthHistoryRepo } from "@wchat/interfaces";
import type { AlertNotifier } from "./alert-engine.js";
import { triggerAlert } from "./alert-engine.js";
import type { HealthProbe } from "./health-checker.js";
import { runHealthChecks } from "./health-checker.js";

// setInterval 의 반환 타입(node: NodeJS.Timeout)에 얽매이지 않도록 opaque 핸들로 둔다.
export type TimerHandle = unknown;

export interface AlertingSchedulerLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface AlertingSchedulerDeps {
  healthHistory: Pick<HealthHistoryRepo, "append">;
  alertEvents: Pick<AlertEventRepo, "insert">;
  notifier: AlertNotifier;
  /** target 이름 → probe. 부트스트랩이 db/redis/e2b/llm 등을 주입. */
  probes: Record<string, HealthProbe>;
  /** health rule 평가 주기(ms). 기본 60s. */
  intervalMs?: number;
  /** 시작 즉시 1회 tick 실행 여부(부트스트랩 초기 신호용). 기본 false. */
  runImmediately?: boolean;
  /** 타이머 주입(테스트용). 기본 setInterval. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** 타이머 해제 주입(테스트용). 기본 clearInterval. */
  clearTimer?: (handle: TimerHandle) => void;
  logger?: AlertingSchedulerLogger;
}

export interface AlertingSchedulerHandle {
  /** 등록된 주기 타이머를 해제한다(누수 방지). 여러 번 호출해도 안전. */
  stop(): void;
  /** 1회 rule 평가(테스트/즉시실행용). 내부 오류는 삼켜 프로세스를 죽이지 않는다. */
  runTick(): Promise<void>;
}

const DEFAULT_INTERVAL_MS = 60_000;

const defaultSetTimer = (fn: () => void, ms: number): TimerHandle =>
  setInterval(fn, ms);
const defaultClearTimer = (handle: TimerHandle): void =>
  clearInterval(handle as ReturnType<typeof setInterval>);

export function startAlertingScheduler(
  deps: AlertingSchedulerDeps,
): AlertingSchedulerHandle {
  const {
    healthHistory,
    alertEvents,
    notifier,
    probes,
    intervalMs = DEFAULT_INTERVAL_MS,
    runImmediately = false,
    setTimer = defaultSetTimer,
    clearTimer = defaultClearTimer,
    logger,
  } = deps;

  let running = false; // tick 겹침 방지(느린 probe 가 다음 tick 전에 끝나지 않는 경우).

  async function runTick(): Promise<void> {
    if (running) return;
    running = true;
    try {
      await runHealthChecks(healthHistory, probes, async (result) => {
        await triggerAlert(alertEvents, notifier, {
          ruleId: "health-target-unhealthy",
          severity: result.status === "down" ? "critical" : "warn",
          message: `health target ${result.target} is ${result.status}`,
          payload: { ...result },
        });
      });
    } catch (err) {
      // rule 평가 실패가 스케줄러/프로세스를 죽이지 않도록 삼킨다(각 tick 은 독립).
      logger?.error("alerting-scheduler tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  }

  const timer = setTimer(() => {
    void runTick();
  }, intervalMs);

  if (runImmediately) void runTick();

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimer(timer);
    },
    runTick,
  };
}

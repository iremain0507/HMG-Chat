// retention-scheduler.ts — 12-OPS-SECURITY.md § 부록 H 데이터 retention.
//   data-retention.ts(runRetention) 는 "1회 실행" 함수만 제공하고, 그 헤더(line 10)가
//   "cron 등록(매일 03:00 KST)은 서버 부트스트랩의 몫" 이라고 명시한다. 여기서 그 주기
//   스케줄러를 제공한다: 매일 03:00 KST 부근에 runRetention 을 1회 실행한다.
//   alerting-scheduler.ts 와 동일하게 node-cron 등 신규 의존성을 쓰지 않고 주입 가능한
//   타이머(setTimer)로 구현 — 테스트는 fake clock/timer + runTick() 직접 호출로 결정적으로
//   검증하고, 실 부트스트랩(index.ts)만 실 타이머를 등록한다. 매 tick 이후 다음 날 실행을
//   다시 예약(one-shot 재무장)해 벽시계 drift 없이 03:00 KST 앵커를 유지한다.
import type { AlertEventRepo } from "@wchat/interfaces";
import type { AlertNotifier } from "./alert-engine.js";
import {
  runRetention,
  type RetentionDataAccess,
  type RetentionStepResult,
} from "./data-retention.js";
import type { ArtifactStore } from "@wchat/interfaces";

// setTimeout/setInterval 의 반환 타입(node: NodeJS.Timeout)에 얽매이지 않도록 opaque 핸들.
export type TimerHandle = unknown;

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * HOUR_MS; // KST = UTC+9 (DST 없음).
const DEFAULT_HOUR_KST = 3; // 매일 03:00 KST.

export interface RetentionSchedulerLogger {
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface RetentionSchedulerDeps {
  da: RetentionDataAccess;
  artifactStore: Pick<ArtifactStore, "cleanupExpired">;
  alerting?: { repo: Pick<AlertEventRepo, "insert">; notifier: AlertNotifier };
  /** 실행 시각(KST 정시). 기본 03:00. */
  hourKst?: number;
  /** 현재 epoch ms 를 반환(테스트용 fake clock). 기본 Date.now. */
  now?: () => number;
  /** one-shot 타이머 주입(테스트용). 기본 setTimeout. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** 타이머 해제 주입(테스트용). 기본 clearTimeout. */
  clearTimer?: (handle: TimerHandle) => void;
  logger?: RetentionSchedulerLogger;
}

export interface RetentionSchedulerHandle {
  /** 예약된 타이머를 해제한다(누수 방지). 여러 번 호출해도 안전. */
  stop(): void;
  /**
   * 1회 retention 실행(스케줄러/테스트용). runRetention 은 단계별 try/catch 로 절대 throw 하지
   * 않지만, 방어적으로 감싸 프로세스를 죽이지 않는다. RetentionStepResult[] 를 반환한다.
   */
  runTick(): Promise<RetentionStepResult[] | undefined>;
}

const defaultSetTimer = (fn: () => void, ms: number): TimerHandle =>
  setTimeout(fn, ms);
const defaultClearTimer = (handle: TimerHandle): void =>
  clearTimeout(handle as ReturnType<typeof setTimeout>);

/** nowMs 로부터 다음 KST 정시(hourKst)까지의 delay(ms). 항상 (0, DAY_MS]. */
export function msUntilNextKstHour(nowMs: number, hourKst: number): number {
  const kstMs = nowMs + KST_OFFSET_MS;
  const msOfDay = ((kstMs % DAY_MS) + DAY_MS) % DAY_MS;
  const target = hourKst * HOUR_MS;
  let delay = target - msOfDay;
  if (delay <= 0) delay += DAY_MS;
  return delay;
}

export function startRetentionScheduler(
  deps: RetentionSchedulerDeps,
): RetentionSchedulerHandle {
  const {
    da,
    artifactStore,
    alerting,
    hourKst = DEFAULT_HOUR_KST,
    now = () => Date.now(),
    setTimer = defaultSetTimer,
    clearTimer = defaultClearTimer,
    logger,
  } = deps;

  let running = false; // tick 겹침 방지(느린 실행이 다음 예약 전에 끝나지 않는 경우).
  let currentTimer: TimerHandle = null;
  let stopped = false;

  async function runTick(): Promise<RetentionStepResult[] | undefined> {
    if (running) return undefined;
    running = true;
    try {
      return await runRetention(da, artifactStore, alerting);
    } catch (err) {
      // retention 실패가 스케줄러/프로세스를 죽이지 않도록 삼킨다(각 tick 은 독립).
      logger?.error("retention-scheduler tick failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    } finally {
      running = false;
    }
  }

  function scheduleNext(): void {
    if (stopped) return;
    const delay = msUntilNextKstHour(now(), hourKst);
    currentTimer = setTimer(() => {
      void (async () => {
        await runTick();
        scheduleNext(); // 다음 날 03:00 KST 로 재무장.
      })();
    }, delay);
  }

  scheduleNext();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (currentTimer != null) clearTimer(currentTimer);
    },
    runTick,
  };
}

// health-checker.ts — 12-OPS-SECURITY.md § Alarms "ALB target unhealthy"/각 서비스 health check.
//   14-INTERFACES.md § HealthCheckResult/HealthHistoryRepo 단일 출처. probe 함수는 호출부(server
//   bootstrap, out of scope)가 DB/Redis/외부 provider 별로 주입 — 여기서는 probe 실행/분류/영속화
//   흐름만 구현한다.
import type { HealthCheckResult, HealthHistoryRepo } from "@wchat/interfaces";

export type HealthProbe = () => Promise<void>;

const DEFAULT_DEGRADED_THRESHOLD_MS = 1000;

export async function checkHealth(
  target: string,
  probe: HealthProbe,
  degradedThresholdMs: number = DEFAULT_DEGRADED_THRESHOLD_MS,
): Promise<HealthCheckResult> {
  const start = Date.now();
  try {
    await probe();
    const latencyMs = Date.now() - start;
    return {
      target,
      status: latencyMs > degradedThresholdMs ? "degraded" : "healthy",
      latencyMs,
    };
  } catch (err) {
    return {
      target,
      status: "down",
      latencyMs: null,
      context: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function runHealthChecks(
  healthHistory: Pick<HealthHistoryRepo, "append">,
  checks: Record<string, HealthProbe>,
  onUnhealthy?: (result: HealthCheckResult) => Promise<void>,
): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = [];
  for (const [target, probe] of Object.entries(checks)) {
    const result = await checkHealth(target, probe);
    await healthHistory.append(result);
    results.push(result);
    if (result.status !== "healthy" && onUnhealthy) {
      await onUnhealthy(result);
    }
  }
  return results;
}

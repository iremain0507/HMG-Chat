// db/health-history-data-access.ts — 06-DATA-MODEL.md § 0011_observability.sql health_check_history +
// 14-INTERFACES.md HealthHistoryRepo 의 pg 구현체 (error-log-data-access.ts 와 동일 패턴).
import type { DataAccess, HealthCheckResult } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type HealthHistoryDataAccess = Pick<DataAccess, "healthHistory">;

function toHealthCheckResult(row: Record<string, unknown>): HealthCheckResult {
  return {
    target: row.target as string,
    status: row.status as HealthCheckResult["status"],
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    ...(row.context !== null && row.context !== undefined
      ? { context: row.context as Record<string, unknown> }
      : {}),
  };
}

export function createPgHealthHistoryDataAccess(): HealthHistoryDataAccess {
  return {
    healthHistory: {
      async append(entry) {
        await pgPool.query(
          `INSERT INTO health_check_history (target, status, latency_ms, context)
           VALUES ($1, $2, $3, $4)`,
          [entry.target, entry.status, entry.latencyMs, entry.context ?? null],
        );
      },
      async recent(target, limit) {
        const res = await pgPool.query(
          `SELECT * FROM health_check_history WHERE target = $1
           ORDER BY created_at DESC LIMIT $2`,
          [target, limit],
        );
        return res.rows.map(toHealthCheckResult);
      },
    },
  };
}

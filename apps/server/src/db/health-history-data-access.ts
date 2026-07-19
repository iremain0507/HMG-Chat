// db/health-history-data-access.ts — 06-DATA-MODEL.md § 0011_observability.sql health_check_history +
// 14-INTERFACES.md HealthHistoryRepo 의 pg 구현체 (error-log-data-access.ts 와 동일 패턴).
import type { DataAccess, HealthCheckResult } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type HealthHistoryDataAccess = Pick<DataAccess, "healthHistory">;

export function toHealthCheckResult(
  row: Record<string, unknown>,
): HealthCheckResult {
  return {
    target: row.target as string,
    status: row.status as HealthCheckResult["status"],
    latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
    // 계약(16-API-CONTRACT.md § admin/health/history)의 ts. created_at 이 없는 행은 생략.
    ...(row.created_at !== null && row.created_at !== undefined
      ? { ts: new Date(row.created_at as string | number | Date) }
      : {}),
    ...(row.context !== null && row.context !== undefined
      ? { context: row.context as Record<string, unknown> }
      : {}),
  };
}

/**
 * P22-T1-10 — from/to 범위 필터. range 생략 시 기존 SQL 과 동일(최신 limit 개).
 * health_check_history_target_idx(target, created_at DESC) 를 그대로 탄다.
 */
export function buildRecentQuery(
  target: string,
  limit: number,
  range?: { from?: Date; to?: Date },
): { text: string; values: unknown[] } {
  const values: unknown[] = [target];
  let where = "target = $1";
  if (range?.from) {
    values.push(range.from);
    where += ` AND created_at >= $${values.length}`;
  }
  if (range?.to) {
    values.push(range.to);
    where += ` AND created_at <= $${values.length}`;
  }
  values.push(limit);
  return {
    text: `SELECT * FROM health_check_history WHERE ${where}
           ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
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
      async recent(target, limit, range) {
        const q = buildRecentQuery(target, limit, range);
        const res = await pgPool.query(q.text, q.values);
        return res.rows.map(toHealthCheckResult);
      },
      // 부록 H 5번 — 보존기간 지난 health_check_history 삭제. 삭제 행 수를 반환.
      async deleteOlderThan(cutoff) {
        const res = await pgPool.query(
          "DELETE FROM health_check_history WHERE created_at < $1",
          [cutoff],
        );
        return res.rowCount ?? 0;
      },
    },
  };
}

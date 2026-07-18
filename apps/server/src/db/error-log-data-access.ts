// db/error-log-data-access.ts — 06-DATA-MODEL.md § 0011_observability.sql error_logs +
// 14-INTERFACES.md ErrorLogRepo 의 pg 구현체.
import type { DataAccess, ErrorLogEntry } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type ErrorLogDataAccess = Pick<DataAccess, "errorLogs">;

function toErrorLog(row: Record<string, unknown>): ErrorLogEntry {
  return {
    level: row.level as ErrorLogEntry["level"],
    category: row.category as ErrorLogEntry["category"],
    message: row.message as string,
    ...(row.context !== null && row.context !== undefined
      ? { context: row.context as Record<string, unknown> }
      : {}),
    ...(row.request_id !== null && row.request_id !== undefined
      ? { requestId: row.request_id as string }
      : {}),
    ...(row.user_id !== null && row.user_id !== undefined
      ? { userId: row.user_id as string }
      : {}),
    ...(row.org_id !== null && row.org_id !== undefined
      ? { orgId: row.org_id as string }
      : {}),
  };
}

export function createPgErrorLogDataAccess(): ErrorLogDataAccess {
  return {
    errorLogs: {
      async append(entry) {
        await pgPool.query(
          `INSERT INTO error_logs (level, category, message, context, request_id, user_id, org_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            entry.level,
            entry.category,
            entry.message,
            entry.context ?? null,
            entry.requestId ?? null,
            entry.userId ?? null,
            entry.orgId ?? null,
          ],
        );
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter.category) {
          conditions.push(`category = $${i}`);
          values.push(filter.category);
          i++;
        }
        if (filter.level) {
          conditions.push(`level = $${i}`);
          values.push(filter.level);
          i++;
        }
        if (filter.from) {
          conditions.push(`created_at >= $${i}`);
          values.push(filter.from);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination.limit);
        const res = await pgPool.query(
          `SELECT * FROM error_logs ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toErrorLog) };
      },
      // 부록 H 4번 — 보존기간 지난 error_logs 삭제. 삭제 행 수를 반환(cron 리포팅용).
      async deleteOlderThan(cutoff) {
        const res = await pgPool.query(
          "DELETE FROM error_logs WHERE created_at < $1",
          [cutoff],
        );
        return res.rowCount ?? 0;
      },
    },
  };
}

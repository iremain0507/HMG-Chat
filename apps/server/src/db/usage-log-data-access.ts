// db/usage-log-data-access.ts — 06-DATA-MODEL.md § 0010_quotas_usage.sql usage_logs +
// 14-INTERFACES.md UsageLogRepo 의 pg 구현체.
import type { DataAccess, UsageLogEntry } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type UsageLogDataAccess = Pick<DataAccess, "usageLogs">;

function toUsageLog(row: Record<string, unknown>): UsageLogEntry {
  return {
    userId: row.user_id as string,
    orgId: row.org_id as string,
    sessionId: (row.session_id as string | null) ?? null,
    provider: row.provider as string,
    model: row.model as string,
    tokensIn: Number(row.tokens_in),
    tokensOut: Number(row.tokens_out),
    costMicros: Number(row.cost_micros),
    createdAt: row.created_at as Date,
  };
}

export function createPgUsageLogDataAccess(): UsageLogDataAccess {
  return {
    usageLogs: {
      async append(entry) {
        await pgPool.query(
          `INSERT INTO usage_logs (user_id, org_id, session_id, provider, model, tokens_in, tokens_out, cost_micros)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            entry.userId,
            entry.orgId,
            entry.sessionId ?? null,
            entry.provider,
            entry.model,
            entry.tokensIn,
            entry.tokensOut,
            entry.costMicros,
          ],
        );
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        if (filter.orgId) {
          conditions.push(`org_id = $${i}`);
          values.push(filter.orgId);
          i++;
        }
        if (filter.fromDate) {
          conditions.push(`created_at >= $${i}`);
          values.push(filter.fromDate);
          i++;
        }
        if (filter.toDate) {
          conditions.push(`created_at <= $${i}`);
          values.push(filter.toDate);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination.limit;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM usage_logs ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toUsageLog) };
      },
      async aggregate(filter) {
        const conditions: string[] = ["created_at >= $1", "created_at <= $2"];
        const values: unknown[] = [filter.fromDate, filter.toDate];
        let i = 3;
        if (filter.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        if (filter.orgId) {
          conditions.push(`org_id = $${i}`);
          values.push(filter.orgId);
          i++;
        }
        const res = await pgPool.query(
          `SELECT
             COALESCE(SUM(tokens_in), 0) AS tokens_in,
             COALESCE(SUM(tokens_out), 0) AS tokens_out,
             COALESCE(SUM(cost_micros), 0) AS cost_micros
           FROM usage_logs WHERE ${conditions.join(" AND ")}`,
          values,
        );
        const row = res.rows[0] as {
          tokens_in: string | number;
          tokens_out: string | number;
          cost_micros: string | number;
        };
        return {
          tokensIn: Number(row.tokens_in),
          tokensOut: Number(row.tokens_out),
          costMicros: Number(row.cost_micros),
        };
      },
    },
  };
}

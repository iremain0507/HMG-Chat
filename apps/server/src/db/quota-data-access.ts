// db/quota-data-access.ts — 06-DATA-MODEL.md § 0010_quotas_usage.sql user_quotas +
// 14-INTERFACES.md UserQuotaRepo 의 pg 구현체 (mcp-server-data-access.ts 와 동일 패턴).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0010_quotas_usage.sql)를 우회한다.
import type { DataAccess, UserQuotaInfo } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type QuotaDataAccess = Pick<DataAccess, "userQuotas">;

function toUserQuota(row: Record<string, unknown>): UserQuotaInfo {
  return {
    userId: row.user_id as string,
    budgetMicros: Number(row.budget_micros),
    usedMicros: Number(row.used_micros),
    periodStart: row.period_start as Date,
    periodEnd: row.period_end as Date,
  };
}

export function createPgQuotaDataAccess(): QuotaDataAccess {
  return {
    userQuotas: {
      async byUserId(userId) {
        const res = await pgPool.query(
          "SELECT * FROM user_quotas WHERE user_id = $1",
          [userId],
        );
        return res.rows[0] ? toUserQuota(res.rows[0]) : null;
      },
      async upsert(info) {
        const res = await pgPool.query(
          `INSERT INTO user_quotas (user_id, budget_micros, used_micros, period_start, period_end)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             budget_micros = EXCLUDED.budget_micros,
             used_micros = EXCLUDED.used_micros,
             period_start = EXCLUDED.period_start,
             period_end = EXCLUDED.period_end
           RETURNING *`,
          [
            info.userId,
            info.budgetMicros,
            info.usedMicros,
            info.periodStart,
            info.periodEnd,
          ],
        );
        return toUserQuota(res.rows[0]);
      },
      async consume(userId, micros) {
        const res = await pgPool.query(
          `UPDATE user_quotas SET used_micros = used_micros + $1
           WHERE user_id = $2 RETURNING budget_micros, used_micros`,
          [micros, userId],
        );
        const row = res.rows[0] as
          | { budget_micros: string | number; used_micros: string | number }
          | undefined;
        if (!row) throw new Error(`user_quotas 레코드가 없습니다: ${userId}`);
        return {
          remaining: Number(row.budget_micros) - Number(row.used_micros),
        };
      },
      async refund(userId, micros) {
        await pgPool.query(
          "UPDATE user_quotas SET used_micros = GREATEST(used_micros - $1, 0) WHERE user_id = $2",
          [micros, userId],
        );
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM user_quotas ${where} ORDER BY user_id LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toUserQuota) };
      },
    },
  };
}

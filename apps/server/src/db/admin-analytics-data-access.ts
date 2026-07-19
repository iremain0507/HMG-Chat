// db/admin-analytics-data-access.ts — P20-T1-15: routes/admin-analytics.ts 의 pg 구현체.
// modelUsageRanking 은 usage_logs(0010, model/tokens/cost 보유) 를 집계하고, messageTimeline
// 은 messages(0002, org_id 컬럼 없음) 를 sessions→users 로 join 해 org 범위를 잡는다.
// groupId 는 group_members(0026, org_id 직접 보유) 로 대상 user_id 를 좁힌다 — org_id 도 함께
// 조건에 걸어 cross-org group_id 가 들어와도 결과가 비도록 이중 방어.
import { pgPool } from "./client.js";
import type {
  AdminAnalyticsDataAccess,
  AnalyticsBucket,
  MessageTimelineBucket,
  ModelUsageRanking,
} from "../routes/admin-analytics.js";

function num(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}

export function createPgAdminAnalyticsDataAccess(): AdminAnalyticsDataAccess {
  return {
    async modelUsageRanking(orgId, from, to, groupId) {
      const values: unknown[] = [orgId, from, to];
      let groupFilter = "";
      if (groupId) {
        values.push(groupId);
        groupFilter = `AND user_id IN (
          SELECT user_id FROM group_members WHERE group_id = $4 AND org_id = $1
        )`;
      }
      const res = await pgPool.query(
        `SELECT
           model,
           COUNT(*) AS messages,
           COALESCE(SUM(tokens_in), 0) AS tokens_in,
           COALESCE(SUM(tokens_out), 0) AS tokens_out,
           COALESCE(SUM(cost_micros), 0) AS cost_micros
         FROM usage_logs
         WHERE org_id = $1 AND created_at BETWEEN $2 AND $3
           AND model IS NOT NULL
           ${groupFilter}
         GROUP BY model
         ORDER BY messages DESC`,
        values,
      );
      return (res.rows as Record<string, unknown>[]).map(
        (row): ModelUsageRanking => ({
          model: row.model as string,
          messages: num(row.messages),
          tokensIn: num(row.tokens_in),
          tokensOut: num(row.tokens_out),
          costMicros: num(row.cost_micros),
        }),
      );
    },

    async messageTimeline(
      orgId: string,
      from: Date,
      to: Date,
      bucket: AnalyticsBucket,
      groupId?: string,
    ) {
      const values: unknown[] = [orgId, from, to, bucket];
      let groupFilter = "";
      if (groupId) {
        values.push(groupId);
        groupFilter = `AND u.id IN (
          SELECT user_id FROM group_members WHERE group_id = $5 AND org_id = $1
        )`;
      }
      const res = await pgPool.query(
        `SELECT date_trunc($4, m.created_at) AS bucket, COUNT(*) AS count
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         JOIN users u ON u.id = s.user_id
         WHERE u.org_id = $1 AND m.created_at BETWEEN $2 AND $3
           ${groupFilter}
         GROUP BY bucket
         ORDER BY bucket ASC`,
        values,
      );
      return (res.rows as Record<string, unknown>[]).map(
        (row): MessageTimelineBucket => ({
          bucket: (row.bucket as Date).toISOString(),
          count: num(row.count),
        }),
      );
    },
  };
}
